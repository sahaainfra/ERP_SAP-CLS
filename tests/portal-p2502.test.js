import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlagService } from '../src/server/modules/core/feature-flags/service.js';
import { createPortalService } from '../src/server/modules/portal/service.js';
import { hashToken, newToken } from '../src/server/platform/identity/tokens.js';
import { todayIST } from '../src/shared/dates.js';
import { partnersOf } from '../src/server/modules/mdm/partners.js';
import { filesOf } from '../src/server/platform/files/registry.js';
import { toPdf } from '../src/server/platform/export/index.js';
import { startApi } from './helpers.js';

test('supplier sessions scope procurement, document intake, invoices, compliance and payments', async (t) => {
  const { db, close, call, raw } = await startApi();
  t.after(async () => {
    await close();
    db.close();
  });
  const flags = createFlagService({ db, environment: 'test' });
  const portal = createPortalService({ db, flags, vaultKey: null });
  const now = Date.now();

  db.prepare("UPDATE core_feature_flags SET default_enabled = 1 WHERE key = 'ff.portal.p2501'").run();
  db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1, 'G1', 'Platform Gate', 'PASSED', 'test', CURRENT_TIMESTAMP),
           (1, 'G2', 'Workforce Gate', 'PASSED', 'test', CURRENT_TIMESTAMP)`).run();

  const projectId = Number(db.prepare(`INSERT INTO org_projects (company_id, code, name, type)
    VALUES (1, 'SUPPLIER-FIXTURE', 'Supplier project', 'ROAD')`).run().lastInsertRowid);
  const partnerId = Number(db.prepare(`INSERT INTO mdm_partners
    (company_id, code, legal_name, constitution, steward_role, partner_status)
    VALUES (1, 'SUPPLIER-FIXTURE', 'Partner fixture', 'OTHER', 'PROCMGR', 'ACTIVE')`).run().lastInsertRowid);
  db.prepare(`INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role)
    VALUES (1, ?, 'VENDOR'), (1, ?, 'SUBCONTRACTOR')`).run(partnerId, partnerId);
  const contactId = Number(db.prepare(`INSERT INTO mdm_partner_contacts (company_id, partner_id, name, project_id)
    VALUES (1, ?, 'Partner contact fixture', ?)`).run(partnerId, projectId).lastInsertRowid);

  function makeSession(role, reference) {
    const accountId = Number(db.prepare(`INSERT INTO ptl_accounts
      (company_id, partner_id, contact_id, project_id, portal_type, doc_no, status, terms_version)
      VALUES (1, ?, ?, ?, ?, ?, 'ACTIVE', '2026-11-20')`).run(partnerId, contactId, projectId, role, reference).lastInsertRowid);
    const token = newToken();
    db.prepare('INSERT INTO ptl_sessions VALUES (?, ?, ?, ?)').run(hashToken(token), accountId, now + 60_000, now);
    return { accountId, token };
  }

  const supplier = makeSession('X-SUP', 'PTL-11111111111111111111111111111111');
  const subcontractor = makeSession('X-SUB', 'PTL-22222222222222222222222222222222');
  const resolve = () => portal.supplierScope(supplier.token);

  assert.throws(resolve, { status: 404 }, 'the supplier flag defaults off');
  db.prepare("UPDATE core_feature_flags SET default_enabled = 1 WHERE key = 'ff.portal.p2502'").run();

  const scope = resolve();
  assert.deepEqual(scope, { companyId: 1, projectId, siteId: null, partnerId, accountId: supplier.accountId });
  assert.ok(Object.isFrozen(scope));
  assert.throws(() => portal.supplierScope(subcontractor.token), { status: 403 });
  assert.throws(() => portal.supplierScope(newToken()), { status: 401 });

  const request = (method, path, { token = supplier.token, key, body } = {}) => call(method, `/api/v1/portal/supplier/${path}`, {
    user: null, company: null, body, headers: { Authorization: `Bearer ${token}`, ...(key ? { 'Idempotency-Key': key } : {}) },
  });
  const pdf = (title) => new Blob([toPdf({ columns: [], rows: [], title })], { type: 'application/pdf' });
  async function upload(label, core = null) {
    const body = new FormData();
    if (core) {
      body.append('entity', 'proc_rfq');
      body.append('entityId', String(core));
    }
    body.append('file', pdf(label), `${label}.pdf`);
    const result = await raw('POST', core ? '/api/v1/core/files' : '/api/v1/portal/supplier/uploads', {
      ...(core ? { user: 'buyer', roles: 'PROCIC', company: '1' } :
        { user: null, company: null, headers: { Authorization: `Bearer ${supplier.token}` } }), body,
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    return result.json.data;
  }
  const scan = (file) => filesOf(db).scanFile({ fileId: file.id, attempt: 1 });
  const today = todayIST();
  const otherProjectId = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'OTHER-SUP-PRJ', 'Other project', 'ROAD')").run().lastInsertRowid);
  const siteId = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'SUP-SITE', 'Supplier site')").run(projectId).lastInsertRowid);
  const otherPartnerId = Number(db.prepare(`INSERT INTO mdm_partners
    (company_id, code, legal_name, constitution, steward_role, partner_status)
    VALUES (1, 'COMPETITOR-FIXTURE', 'Competitor fixture', 'OTHER', 'PROCMGR', 'ACTIVE')`).run().lastInsertRowid);

  const makeRfq = (doc, pid, pidPartner, due) => {
    const rfq = Number(db.prepare(`INSERT INTO proc_rfqs (company_id, doc_no, doc_date, org_project_id, title, due_date, status, requested_by)
      VALUES (1, ?, ?, ?, 'RFQ for supplier', ?, 'ISSUED', 'buyer')`).run(doc, today, pid, due).lastInsertRowid);
    db.prepare('INSERT INTO proc_rfq_vendors (company_id, rfq_id, vendor_id) VALUES (1, ?, ?)').run(rfq, pidPartner);
    return rfq;
  };
  const rfq = makeRfq('RFQ/SUP/1', projectId, partnerId, '2099-12-01');
  const expired = makeRfq('RFQ/SUP/2', projectId, partnerId, '2001-12-01');
  const foreignProject = makeRfq('RFQ/SUP/3', otherProjectId, partnerId, '2099-12-01');
  const competitor = makeRfq('RFQ/SUP/4', projectId, otherPartnerId, '2099-12-01');
  const pr = Number(db.prepare(`INSERT INTO proc_requisitions
    (company_id, doc_no, doc_date, org_project_id, required_by, pr_source, requested_by, status)
    VALUES (1, 'PR/SUP/1', ?, ?, ?, 'DIRECT', 'buyer', 'APPROVED')`).run(today, projectId, today).lastInsertRowid);
  const prLine = Number(db.prepare(`INSERT INTO proc_pr_lines
    (company_id, pr_id, line_no, service_desc, qty, uom, required_by)
    VALUES (1, ?, 1, 'Supply service', 1000, 'job', ?)`).run(pr, today).lastInsertRowid);
  const rfqLine = Number(db.prepare(`INSERT INTO proc_rfq_lines
    (company_id, rfq_id, line_no, pr_line_id, service_desc, qty, uom, delivery_site_id)
    VALUES (1, ?, 1, ?, 'Supply service', 1000, 'job', ?)`).run(rfq, prLine, siteId).lastInsertRowid);
  db.prepare(`INSERT INTO proc_quotations (company_id, doc_no, rfq_id, vendor_id, org_project_id,
    quote_ref, quote_date, valid_until, status) VALUES (1, 'QTN/COMP', ?, ?, ?, 'private-rival-quote', ?, ?, 'RECEIVED')`)
    .run(rfq, otherPartnerId, projectId, today, '2099-12-01');
  db.prepare(`INSERT INTO proc_rfq_clarifications (company_id, rfq_id, vendor_id, asked_by, question, answer)
    VALUES (1, ?, ?, 'rival', 'private-rival-question', 'private-rival-answer')`).run(rfq, otherPartnerId);

  const inbox = await request('GET', 'rfqs');
  assert.equal(inbox.status, 200, JSON.stringify(inbox.json));
  assert.deepEqual(inbox.json.data.items.map((item) => item.id), [expired, rfq]);
  assert.equal((await request('GET', 'rfqs', { token: subcontractor.token })).status, 403);
  for (const missing of [foreignProject, competitor]) assert.equal((await request('GET', `rfqs/${missing}`)).status, 404);
  const info = await request('GET', `rfqs/${rfq}`);
  assert.equal(info.status, 200, JSON.stringify(info.json));
  assert.equal(info.json.data.quote, null);
  assert.equal(info.json.data.revision, 0);
  assert.doesNotMatch(JSON.stringify(info.json), /private-rival|token_hash/);
  const quotation = { version: 0, data: { quoteRef: 'SUP/Q1', validUntil: '2099-12-01', lines: [{ rfqLineId: rfqLine, rate: 100 }] } };
  const send = (id, body, key) => request('POST', `rfqs/${id}/quotations`, { body, key });
  assert.equal((await send(expired, quotation, 'supplier-late-001')).status, 409);
  assert.equal((await send(competitor, quotation, 'supplier-rival-001')).status, 404);
  assert.equal((await send(rfq, quotation)).status, 400);
  const received = await send(rfq, quotation, 'supplier-quote-001');
  assert.equal(received.status, 201, JSON.stringify(received.json));
  const retry = await send(rfq, quotation, 'supplier-quote-001');
  assert.equal(retry.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(retry.json, received.json);
  const rfqPdf = await upload('supplier-rfq-spec', rfq);
  await scan(rfqPdf);
  assert.deepEqual((await request('GET', `rfqs/${rfq}`)).json.data.attachments, []);
  const shareFile = await call('POST', `/api/v1/proc/rfqs/${rfq}/files/${rfqPdf.id}/share`, {
    user: 'buyer', roles: 'PROCIC', headers: { 'Idempotency-Key': 'share-rfq-file-001' }, body: { shared: true },
  });
  assert.equal(shareFile.status, 200, JSON.stringify(shareFile.json));
  const rfqDownload = await raw('GET', `/api/v1/portal/supplier/rfqs/${rfq}/files/${rfqPdf.id}`, {
    user: null, company: null, headers: { Authorization: `Bearer ${supplier.token}` },
  });
  assert.equal(rfqDownload.status, 200, JSON.stringify(rfqDownload.json));
  assert.equal(rfqDownload.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await request('GET', `rfqs/${competitor}/files/${rfqPdf.id}`)).status, 404);
  const stagedQuote = await upload('signed-quotation');
  await scan(stagedQuote);
  assert.equal((await request('GET', `uploads/${stagedQuote.id}`)).json.data.scanStatus, 'CLEAN');

  assert.equal((await send(rfq, quotation, 'supplier-stale-001')).status, 409);
  const revised = await send(rfq, { version: 1, fileIds: [stagedQuote.id], data: { ...quotation.data, quoteRef: 'SUP/Q2' } }, 'supplier-quote-002');
  assert.equal(revised.status, 201, JSON.stringify(revised.json));
  const comparison = await call('GET', `/api/v1/proc/rfqs/${rfq}/comparison`, { roles: 'PROCIC', user: 'buyer' });
  assert.equal(comparison.status, 200, JSON.stringify(comparison.json));
  assert.equal(comparison.json.data.vendors.find((vendor) => vendor.vendorId === partnerId).versionNo, 2);
  const statement = await call('POST', '/api/v1/proc/comparative-statements', {
    user: 'buyer', roles: 'PROCIC', headers: { 'Idempotency-Key': 'supplier-comparison-001' }, body: { rfqId: rfq },
  });
  assert.equal(statement.status, 201, JSON.stringify(statement.json));
  assert.equal(statement.json.data.vendors.find((vendor) => vendor.vendorId === partnerId).quotationNo, revised.json.data.docNo);
  assert.equal((await request('GET', `uploads/${stagedQuote.id}`)).status, 404);
  assert.equal(db.prepare('SELECT linked_entity FROM core_files WHERE id = ?').get(stagedQuote.id).linked_entity, 'proc_quotation');
  assert.equal((await send(rfq, { version: 2, fileIds: [stagedQuote.id], data: quotation.data }, 'supplier-reuse-001')).status, 404);
  assert.equal((await request('GET', `rfqs/${rfq}`)).json.data.revision, 2, 'file failure rolls back the quotation');
  const clarification = await request('POST', `rfqs/${rfq}/clarifications`, {
    key: 'supplier-question-001', body: { question: 'Please confirm the delivery location.' },
  });
  assert.equal(clarification.status, 201, JSON.stringify(clarification.json));
  const revisedInfo = (await request('GET', `rfqs/${rfq}`)).json.data;
  assert.equal(revisedInfo.quote.quoteRef, 'SUP/Q2');
  assert.deepEqual(revisedInfo.clarifications, [{ question: 'Please confirm the delivery location.', answer: null }]);

  const insertOrder = (doc, vendor) => Number(db.prepare(`INSERT INTO proc_purchase_orders
    (company_id, doc_no, doc_date, org_project_id, po_site_id, vendor_id, status, requested_by)
    VALUES (1, ?, ?, ?, ?, ?, 'APPROVED', 'buyer')`).run(doc, today, projectId, siteId, vendor).lastInsertRowid);
  const po = insertOrder('PO/SUP/1', partnerId);
  const rivalPo = insertOrder('PO/SUP/2', otherPartnerId);
  const poLine = Number(db.prepare(`INSERT INTO proc_po_lines (company_id, po_id, line_no, description, qty, uom, balance_qty)
    VALUES (1, ?, 1, 'Goods', 5000, 'nos', 5000)`).run(po).lastInsertRowid);
  assert.equal((await request('GET', `orders/${rivalPo}`)).status, 404);
  const order = await request('GET', `orders/${po}`);
  assert.equal(order.status, 200, JSON.stringify(order.json));
  const ack = await request('POST', `orders/${po}/acknowledgments`, {
    key: 'supplier-ack-001', body: { version: order.json.data.version, data: { note: 'Schedule confirmed' } },
  });
  assert.equal(ack.status, 200, JSON.stringify(ack.json));
  const fresh = (await request('GET', `orders/${po}`)).json.data;
  assert.ok(fresh.acknowledgedAt);
  const dispatch = { dispatchDate: today, lrNo: 'LR/001', vehicleNo: 'MH12AB1234', ewayBillNo: '123456789012', lines: [{ poLineId: poLine, qty: 3 }] };
  const asn = (version, key, fileIds = undefined) => request('POST', `orders/${po}/dispatches`, { key, body: { version, data: dispatch, fileIds } });
  const asnPdf = await upload('dispatch-invoice');
  await scan(asnPdf);
  const sent = await asn(fresh.version, 'supplier-dispatch-001', [asnPdf.id]);
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.deepEqual((await asn(fresh.version, 'supplier-dispatch-001', [asnPdf.id])).json, sent.json);
  assert.equal((await asn(fresh.version, 'supplier-dispatch-stale')).status, 409);
  const dispatched = (await request('GET', `orders/${po}`)).json.data;
  assert.equal(dispatched.dispatches.length, 1);
  assert.equal(db.prepare('SELECT file_id FROM ptl_asn_invoices WHERE dispatch_id = ?').get(sent.json.data.id).file_id, asnPdf.id);
  assert.equal((await asn(dispatched.version, 'supplier-dispatch-excess')).status, 400);

  const plan = Number(db.prepare(`INSERT INTO xpd_expediting_plans (company_id, doc_no, doc_date, po_id, org_project_id,
    required_on_site, status, requested_by) VALUES (1, 'XPD/SUP/1', ?, ?, ?, '2099-12-01', 'APPROVED', 'buyer')`)
    .run(today, po, projectId).lastInsertRowid);
  const milestone = Number(db.prepare(`INSERT INTO xpd_milestones (company_id, plan_id, seq_no, name, planned_date)
    VALUES (1, ?, 1, 'Goods ready', '2099-11-01')`).run(plan).lastInsertRowid);
  const milestones = await request('GET', `orders/${po}/milestones`);
  assert.equal(milestones.status, 200, JSON.stringify(milestones.json));
  const progress = await request('POST', `orders/${po}/milestones/${milestone}`, {
    key: 'supplier-milestone-001', body: { version: milestones.json.data.milestones[0].version, data: { actualDate: today } },
  });
  assert.equal(progress.status, 200, JSON.stringify(progress.json));
  assert.equal((await request('GET', `orders/${po}/milestones`)).json.data.milestones[0].status, 'DONE');

  db.prepare(`INSERT INTO bill_vendor_invoices (company_id, doc_no, org_project_id, vendor_id, invoice_no, invoice_date,
    fy, po_id, requested_by, status, match_status, total_paise)
    VALUES (1, 'VIN/SUP/1', ?, ?, 'SUP-INV-1', ?, '2026-27', ?, 'buyer', 'SUBMITTED', 'MATCHED', 10000),
           (1, 'VIN/RIV/1', ?, ?, 'RIVAL-INV-1', ?, '2026-27', ?, 'buyer', 'SUBMITTED', 'MATCHED', 10000)`)
    .run(projectId, partnerId, today, po, projectId, otherPartnerId, today, po);
  const invoiceStatus = (await request('GET', `orders/${po}`)).json.data.invoices;
  assert.deepEqual(invoiceStatus.map((row) => [row.invoiceNo, row.matchStatus, row.total]), [['SUP-INV-1', 'MATCHED', 100]]);

  const invoiceId = db.prepare("SELECT id FROM bill_vendor_invoices WHERE doc_no = 'VIN/SUP/1'").get().id;
  db.prepare("UPDATE bill_vendor_invoices SET status = 'APPROVED' WHERE id = ?").run(invoiceId);
  const apId = Number(db.prepare(`INSERT INTO ap_bills
    (company_id, doc_no, bill_source, source_ref, org_project_id, partner_id, payee_name, bill_no,
     bill_date, due_date, status, total_paise, net_payable_paise, paid_paise)
    VALUES (1, 'AP/SUP/1', 'VENDOR_INVOICE', ?, ?, ?, 'Partner fixture', 'SUP-INV-1', ?, ?, 'APPROVED', 10000, 10000, 7000)`)
    .run(String(invoiceId), projectId, partnerId, today, today).lastInsertRowid);
  const ledgerId = db.prepare('SELECT id FROM fin_accounts ORDER BY id LIMIT 1').get().id;
  const bankId = Number(db.prepare(`INSERT INTO fin_bank_accounts
    (company_id, code, name, bank_name, ifsc, account_no_enc, account_last4, gl_account_id)
    VALUES (1, 'SUP-BANK', 'Test account', 'Test bank', 'TEST0000001', 'fixture', '0000', ?)`).run(ledgerId).lastInsertRowid);
  const proposal = Number(db.prepare(`INSERT INTO pmt_proposals
    (company_id, doc_no, bank_account_id, pay_mode, pay_date, status, run_status)
    VALUES (1, 'PROP/SUP/1', ?, 'NEFT', ?, 'APPROVED', 'CONFIRMED')`).run(bankId, today).lastInsertRowid);
  const paymentLine = Number(db.prepare(`INSERT INTO pmt_proposal_lines
    (company_id, proposal_id, line_no, line_kind, ap_bill_id, partner_id, payee_name, amount_paise, line_status)
    VALUES (1, ?, 1, 'BILL', ?, ?, 'Partner fixture', 7000, 'PAID')`).run(proposal, apId, partnerId).lastInsertRowid);
  const payment = Number(db.prepare(`INSERT INTO pmt_payments
    (company_id, doc_no, proposal_id, line_id, partner_id, payee_name, pay_mode, bank_account_id, amount_paise,
      utr, released_on, paid_on, pay_status)
    VALUES (1, 'PMT/SUP/1', ?, ?, ?, 'Partner fixture', 'NEFT', ?, 7000, 'TESTUTR000000', ?, ?, 'PAID')`)
    .run(proposal, paymentLine, partnerId, bankId, today, today).lastInsertRowid);
  const invoicePaid = (await request('GET', `orders/${po}`)).json.data.invoices[0];
  assert.deepEqual([invoicePaid.amountDue, invoicePaid.paid, invoicePaid.payments[0].utr], [30, 70, 'TESTUTR000000']);
  const advice = await raw('GET', `/api/v1/portal/supplier/orders/${po}/payments/${payment}/advice`, {
    user: null, company: null, headers: { Authorization: `Bearer ${supplier.token}` },
  });
  assert.equal(advice.status, 200, JSON.stringify(advice.json));
  assert.equal(advice.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await request('GET', `orders/${rivalPo}/payments/${payment}/advice`)).status, 404);

  const store = Number(db.prepare(`INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, requested_by)
    VALUES (1, 'SUP-STORE', 'Supplier store', 'SITE_STORE', ?, ?, 'buyer')`).run(projectId, siteId).lastInsertRowid);
  const category = Number(db.prepare(`INSERT INTO mdm_item_categories
    (company_id, code, name, code_prefix, steward_role, category_status)
    VALUES (1, 'SUP-CAT', 'Supplier items', 'SUP', 'PROCMGR', 'ACTIVE')`).run().lastInsertRowid);
  const item = Number(db.prepare(`INSERT INTO mdm_items
    (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status)
    VALUES (1, 'SUP-ITEM', 'Supplier stock item', 'MATERIAL', ?, 'nos', ?, 'ACTIVE')`).run(category, today).lastInsertRowid);
  const grn = Number(db.prepare(`INSERT INTO inv_grns
    (company_id, doc_no, received_date, org_project_id, org_site_id, store_id, po_id, vendor_id, status, requested_by)
    VALUES (1, 'GRN/SUP/1', ?, ?, ?, ?, ?, ?, 'APPROVED', 'buyer')`)
    .run(today, projectId, siteId, store, po, partnerId).lastInsertRowid);
  db.prepare(`INSERT INTO inv_grn_lines (company_id, grn_id, line_no, po_line_id, item_id, uom, received_qty, accepted_qty,
    rejected_qty, inspection_required, inspection_status, released_qty, qc_rejected_qty)
    VALUES (1, ?, 1, ?, ?, 'nos', 3000, 2000, 1000, 1, 'PARTIAL', 1000, 1000)`).run(grn, poLine, item);
  db.prepare(`INSERT INTO proc_po_receipts (company_id, po_id, po_line_id, grn_ref, received_on, qty, accepted_qty)
    VALUES (1, ?, ?, 'GRN/SUP/1', ?, 3000, 2000)`).run(po, poLine, today);
  const [receipt] = (await request('GET', `orders/${po}`)).json.data.receipts;
  assert.deepEqual([receipt.qty, receipt.acceptedQty, receipt.rejectedQty, receipt.inspection, receipt.releasedQty, receipt.qcRejectedQty],
    [3, 2, 1, 'PARTIAL', 1, 1]);

  const invoicePdf = await upload('gst-invoice');
  await scan(invoicePdf);
  db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (1, 'accounts-fixture', 'Accounts manager', ?)")
    .run(JSON.stringify(['ACCMGR']));
  const vendorInvoice = { fileId: invoicePdf.id, data: { invoiceNo: 'SUP-INTAKE-001', invoiceDate: today, declaredTotal: 0,
    lines: [{ poLineId: poLine, qty: 1, rate: 0, gstPct: 0 }] } };
  const lateMatch = await request('POST', `orders/${po}/invoices`, { key: 'supplier-invoice-no-match', body: {
    ...vendorInvoice, data: { ...vendorInvoice.data, lines: [{ poLineId: poLine, qty: 10, rate: 0, gstPct: 0 }] },
  } });
  assert.equal(lateMatch.status, 400, JSON.stringify(lateMatch.json));
  assert.equal((await request('GET', `uploads/${invoicePdf.id}`)).status, 200);
  const intake = await request('POST', `orders/${po}/invoices`, { key: 'supplier-invoice-valid', body: vendorInvoice });
  assert.equal(intake.status, 201, JSON.stringify(intake.json));
  assert.equal(intake.json.data.status, 'SUBMITTED');
  assert.equal(intake.json.data.matchStatus, 'MATCHED');
  const storedInvoice = db.prepare('SELECT * FROM bill_vendor_invoices WHERE invoice_no = ?').get(vendorInvoice.data.invoiceNo);
  assert.ok(storedInvoice.workflow_instance_id);
  assert.equal(db.prepare('SELECT linked_id FROM core_files WHERE id = ?').get(invoicePdf.id).linked_id, storedInvoice.id);
  const duplicate = await request('POST', `orders/${po}/invoices`, { key: 'supplier-invoice-duplicate', body: vendorInvoice });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.json));
  const unknownGstin = await request('POST', `orders/${po}/invoices`, { key: 'supplier-invoice-gstin', body: {
    ...vendorInvoice, data: { ...vendorInvoice.data, invoiceNo: 'SUP-INTAKE-002', vendorGstin: '27ABCDE1234F1Z5' },
  } });
  assert.equal(unknownGstin.status, 400, JSON.stringify(unknownGstin.json));
  assert.ok(unknownGstin.json.error.details.some((detail) => detail.field === 'vendorGstin'));


  db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'pm-fixture', 'test')").run(projectId);
  const vdrCreated = await call('POST', '/api/v1/engg/vdr-items', {
    user: 'eng-coordinator', roles: 'DESIGN', headers: { 'Idempotency-Key': 'supplier-vdr-create' },
    body: { projectId, poRef: 'PO/SUP/1', vendor: 'Partner fixture', docType: 'DATA_SHEET', title: 'Supplier test sheet',
      dueDate: today, shareWithSupplier: true },
  });
  assert.equal(vdrCreated.status, 201, JSON.stringify(vdrCreated.json));
  const requirements = (await request('GET', `orders/${po}`)).json.data.vendorDocuments;
  const requirement = requirements.find((v) => v.id === vdrCreated.json.data.id);
  assert.equal(requirement.status, 'REQUIRED');
  const vdrPdf = await upload('vendor-submission');
  await scan(vdrPdf);
  const vdr = await request('POST', `orders/${po}/vendor-documents/${requirement.id}`, { key: 'supplier-vdr-submit', body: {
    version: requirement.version, fileId: vdrPdf.id,
  } });
  assert.equal(vdr.status, 201, JSON.stringify(vdr.json));
  assert.equal(vdr.json.data.status, 'RECEIVED');
  assert.equal(db.prepare('SELECT linked_entity FROM core_files WHERE id = ?').get(vdrPdf.id).linked_entity, 'engg_vdr_item');
  assert.equal((await request('GET', 'compliance')).status, 404);

  db.prepare(`INSERT INTO vnd_scorecards (company_id, partner_id, period, period_from, period_to, computed_at, total_score)
    VALUES (1, ?, '2026-11', '2026-11-01', '2026-11-30', ?, 930000),
           (1, ?, '2026-11', '2026-11-01', '2026-11-30', ?, 1000000)`).run(partnerId, today, otherPartnerId, today);
  assert.equal((await request('GET', 'scorecards')).status, 404, 'a project grant cannot read company-wide scores');
  db.prepare('UPDATE ptl_accounts SET project_id = NULL WHERE id = ?').run(supplier.accountId);
  db.prepare('UPDATE mdm_partner_contacts SET project_id = NULL WHERE id = ?').run(contactId);
  const scorecards = await request('GET', 'scorecards');
  assert.equal(scorecards.status, 200, JSON.stringify(scorecards.json));
  assert.deepEqual(scorecards.json.data.items.map((row) => [row.period, row.total]), [['2026-11', 93]]);
  db.prepare(`INSERT INTO core_parameters (key, value, data_type, scope_type, scope_id, effective_from, company_id)
    VALUES ('mdm.partner.blocking_documents', ?, 'json', 'company', 1, '2020-01-01', 1)`).run(JSON.stringify(['INSURANCE']));
  db.prepare(`INSERT INTO mdm_partner_documents (company_id, partner_id, doc_type, valid_until, source_type)
    VALUES (1, ?, 'INSURANCE', '2001-01-01', 'mdm_partner')`).run(partnerId);
  const canSupply = () => partnersOf(db).selectable({ user: 'buyer', companyId: 1 }, partnerId).selectable;
  assert.equal(canSupply(), false);
  const compliancePdf = await upload('insurance-renewal');
  await scan(compliancePdf);
  const renewal = await request('POST', 'compliance', { key: 'supplier-compliance-renewal', body: {
    docType: 'INSURANCE', docNo: 'INS-SUP-1', validFrom: today, validUntil: '2099-12-01', fileId: compliancePdf.id,
  } });
  assert.equal(renewal.status, 201, JSON.stringify(renewal.json));
  assert.equal((await request('GET', 'compliance')).json.data.items[0].verified, false);
  assert.equal(canSupply(), false, 'an unverified renewal cannot clear the expired compliance block');
  const verified = await call('POST', `/api/v1/mdm/partners/${partnerId}/documents/${renewal.json.data.id}/verify`, {
    user: 'accounts-fixture', roles: 'ACCMGR', headers: { 'Idempotency-Key': 'verify-renewal-001' }, body: {},
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.json));
  assert.equal((await request('GET', 'compliance')).json.data.items[0].verified, true);
  assert.equal(canSupply(), true);
  db.prepare('UPDATE ptl_accounts SET project_id = ? WHERE id = ?').run(projectId, supplier.accountId);
  db.prepare('UPDATE mdm_partner_contacts SET project_id = ? WHERE id = ?').run(projectId, contactId);

  db.prepare('UPDATE ptl_accounts SET site_id = ? WHERE id = ?').run(siteId, supplier.accountId);
  db.prepare('UPDATE mdm_partner_contacts SET site_id = ? WHERE id = ?').run(siteId, contactId);
  assert.equal((await request('GET', `rfqs/${rfq}`)).status, 200);
  assert.equal((await request('GET', `orders/${po}`)).status, 200);
  db.prepare('UPDATE proc_rfq_lines SET delivery_site_id = NULL WHERE id = ?').run(rfqLine);
  assert.equal((await request('GET', `rfqs/${rfq}`)).status, 404);
  assert.equal((await send(rfq, quotation, 'supplier-quote-001')).status, 404, 'a response cannot replay outside the current grant');
  const secondSite = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'SUP-SITE-2', 'Second site')").run(projectId).lastInsertRowid);
  db.prepare('UPDATE proc_po_lines SET delivery_site_id = ? WHERE id = ?').run(secondSite, poLine);
  assert.equal((await request('GET', `orders/${po}`)).status, 404);
  db.prepare('UPDATE ptl_accounts SET site_id = NULL WHERE id = ?').run(supplier.accountId);
  db.prepare('UPDATE mdm_partner_contacts SET site_id = NULL WHERE id = ?').run(contactId);

  db.prepare("UPDATE core_feature_flags SET default_enabled = 0 WHERE key = 'ff.portal.p2501'").run();
  assert.throws(resolve, { status: 401 });
  db.prepare("UPDATE core_feature_flags SET default_enabled = 1 WHERE key = 'ff.portal.p2501'").run();
  db.prepare("UPDATE hr_gates SET status = 'RETURNED' WHERE company_id = 1 AND code = 'G2'").run();
  assert.throws(resolve, { status: 401 });
  db.prepare("UPDATE hr_gates SET status = 'PASSED' WHERE company_id = 1 AND code = 'G2'").run();
  db.prepare('UPDATE mdm_partner_contacts SET is_active = 0 WHERE id = ?').run(contactId);
  assert.throws(resolve, { status: 401 });
  db.prepare('UPDATE mdm_partner_contacts SET is_active = 1 WHERE id = ?').run(contactId);
  db.prepare("UPDATE ptl_accounts SET status = 'REVOKED' WHERE id = ?").run(supplier.accountId);
  assert.throws(resolve, { status: 401 });
});
