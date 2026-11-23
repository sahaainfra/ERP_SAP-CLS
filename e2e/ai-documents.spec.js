import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Part 28.04 (AC-01, T-01, T-UI-01, T-UI-02): Extraction Review on a 1280 px desktop and a 360 px phone. A vendor invoice and a letter are
// uploaded to the document register; each is read on upload; the finance executive reviews the invoice beside its suggestions (the
// low-confidence vendor name must be confirmed) and accepts it into a vendor invoice DRAFT; the document controller accepts the letter as an
// inward letter. No horizontal scroll, no clipped labels at larger text, no console errors.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main button, main .kpi-label, main .kpi-value')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstin = (first14) => { let s = 0; for (let i = 0; i < 14; i += 1) { const p = B36.indexOf(first14[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + (p % 36); } return first14 + B36[(36 - (s % 36)) % 36]; };
const pdf = async (lines) => { const p = await PDFDocument.create(); const font = await p.embedFont(StandardFonts.Helvetica); const page = p.addPage([595, 842]); lines.forEach((l, i) => page.drawText(l, { x: 40, y: 800 - i * 18, size: 11, font })); return Buffer.from(await p.save()); };

test('Extraction Review: an invoice and a letter read on upload, reviewed beside the document and accepted into drafts', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const G = gstin(phone ? '36AABCS1429B1Z' : '36AABCT7788C1Z');
  const users = { fin: `di-fin-${suffix}`, doc: `di-doc-${suffix}` };
  const headers = (roles, company, user, extra = {}) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID(), ...extra });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `DIX-${suffix.toUpperCase()}`, legalName: 'Document Demo Infrastructure', shortName: 'Document Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company, 'setup'), data: { legalName: 'Document Demo Infrastructure', reason: 'Set up the document fixture' } })).ok()).toBe(true);
  let project; let po;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['fin', 'FINEX'], ['doc', 'DOC']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.ai.p2804', ?, 'Document browser fixture', 0, 1)").run(company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'DX-01', 'Outer ring road', 'ROAD', 'ACTIVE')").run(company).lastInsertRowid);
    db.prepare("INSERT INTO proj_projects (company_id, project_id, status, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (?, ?, 'APPROVED', 'EXECUTION', 'pm', 100000000, '2026-01-01', '2027-12-31', 'e2e')").run(company, project);
    db.exec('PRAGMA foreign_keys = OFF');
    const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, 'VSC', 'Shree Cement Traders Pvt Ltd', 'Shree', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(company).lastInsertRowid);
    db.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, state_code, gstin, gstin_status) VALUES (?, ?, '36', ?, 'ACTIVE')").run(company, vendor, G);
    po = Number(db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, status, requested_by, vendor_gstin) VALUES (?, ?, '2026-11-01', ?, ?, 'APPROVED', 'buyer', ?)").run(company, `PO/DX/${suffix}`, project, vendor, G).lastInsertRowid);
    const cat = db.prepare('SELECT id FROM mdm_item_categories ORDER BY id LIMIT 1').get().id;
    const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from) VALUES (?, 'OPC53', 'OPC cement 53', 'MATERIAL', ?, 'bag', '2024-01-01')").run(company, cat).lastInsertRowid);
    const store = Number(db.prepare("INSERT INTO inv_stores (company_id, org_project_id, code, name, store_type, requested_by) VALUES (?, ?, 'S1', 'Main store', 'SITE_STORE', 'stores')").run(company, project).lastInsertRowid);
    const pl = Number(db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, rate, gst_pct) VALUES (?, ?, 1, ?, 'OPC cement 53', 300000, 'bag', 50000, 180000)").run(company, po, item).lastInsertRowid);
    const grn = Number(db.prepare("INSERT INTO inv_grns (company_id, doc_no, po_id, vendor_id, store_id, org_project_id, received_date, status, requested_by) VALUES (?, ?, ?, ?, ?, ?, '2026-11-12', 'APPROVED', 'stores')").run(company, `GRN/DX/${suffix}`, po, vendor, store, project).lastInsertRowid);
    db.prepare("INSERT INTO inv_grn_lines (company_id, grn_id, line_no, po_line_id, item_id, uom, received_qty, accepted_qty) VALUES (?, ?, 1, ?, ?, 'bag', 200000, 200000)").run(company, grn, pl, item);
    db.exec('PRAGMA foreign_keys = ON');
  } finally {
    db.close();
  }
  // FR-01: the files go through the document register (04.10); each is read when the virus scan clears it
  const upload = async (name, lines) => {
    const d = await request.post('/api/v1/doc/documents', { headers: headers('DOC', company, users.doc), data: { title: name, docType: 'DRAWING', projectId: project } });
    expect(d.status(), await d.text()).toBe(201);
    const g = (await (await request.get(`/api/v1/doc/documents/${(await d.json()).data.id}`, { headers: headers('DOC', company, users.doc) })).json()).data;
    const f = await request.post('/api/v1/core/files', { headers: headers('DOC', company, users.doc), multipart: { entity: 'doc_version', entityId: String(g.draftVersionId), file: { name, mimeType: 'application/pdf', buffer: await pdf(lines) } } });
    expect(f.status(), await f.text()).toBe(201);
  };
  await upload('shree-invoice.pdf', ['Shree Cement Traders Pvt Ltd', 'Plot 12, Industrial Area, Hyderabad', `GSTIN: ${G}`, 'TAX INVOICE', `Invoice No: INV-2026/${phone ? '0457' : '0458'}`, 'Invoice Date: 14-11-2026',
    'HSN 2523 OPC cement 53 grade 200 bags', 'Taxable Value: 1,00,000.00', 'IGST 18%: 18,000.00', 'Grand Total: Rs 1,18,000.00']);
  await upload('rb-notice.pdf', ['From: Roads and Buildings Department, Hyderabad', 'Ref No: RB/EE/2026/442', 'Date: 18-11-2026', 'To: The Project Manager', 'Subject: Notice of delay in pier cap casting at P12', 'Dear Sir,', 'You are hereby given notice of the delay.', 'Yours faithfully,']);
  await expect.poll(async () => (await (await request.get('/api/v1/ai/documents?status=ALL', { headers: headers('DOC', company, users.doc) })).json()).data?.total, { timeout: 30_000 }).toBe(2);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.fin, roles: 'FINEX', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // the worklist, oldest first, with its SLA chip; the invoice opens beside its suggestions
  await page.goto('/ai/documents');
  await expect(page.getByRole('heading', { name: 'Extraction Review', level: 1 })).toBeVisible();
  await expect(page.getByTestId('di-row')).toHaveCount(2);
  await expect(page.getByTestId('di-row').first()).toContainText(' h');
  await page.getByTestId('di-row').filter({ hasText: 'shree-invoice.pdf' }).getByRole('link').click();
  const review = page.getByTestId('di-review');
  await expect(review).toContainText('Vendor invoice');
  await expect(page.getByTestId('di-text').locator('mark[data-field="invoiceNo"]')).toContainText('INV-2026/');
  await expect(review).toContainText('Vendor found by its GSTIN: Shree Cement Traders Pvt Ltd');
  // BR-01: the vendor name was a guess: accepting waits until it is confirmed
  await page.getByLabel('Purchase order *').selectOption(String(po));
  await expect(page.getByTestId('di-pending')).toContainText('Vendor');
  await expect(page.getByTestId('di-accept')).toBeDisabled();
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/28.04/${phone ? 'mobile' : 'desktop'}-extraction-review-with-side-by-side-docu.png`, fullPage: true });
  await checkAppearance(page);
  await page.getByTestId('di-confirm-vendorName').check();
  await page.getByTestId('di-accept').click();
  await expect(page.getByTestId('di-applied')).toContainText('Draft created');
  const check = new DatabaseSync('data/e2e.sqlite');
  try {
    const vi = check.prepare('SELECT status, source, declared_total_paise FROM bill_vendor_invoices WHERE company_id = ? ORDER BY id DESC LIMIT 1').get(company);
    expect([vi.status, vi.source, vi.declared_total_paise]).toEqual(['DRAFT', 'OCR', 11_800_000]);
  } finally { check.close(); }
  // the document controller accepts the letter as an inward letter of the project
  await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: users.doc, roles: 'DOC', company: String(company) });
  await page.goto('/ai/documents');
  await page.getByTestId('di-row').filter({ hasText: 'rb-notice.pdf' }).getByRole('link').click();
  await expect(page.getByTestId('di-review')).toContainText('Letter');
  for (const box of await page.locator('[data-testid^="di-confirm-"]').all()) await box.check();
  await page.getByLabel('Project *').selectOption(String(project));
  await page.getByTestId('di-accept').click();
  await expect(page.getByTestId('di-applied')).toContainText('Draft created');
  await noOverflow();
  expect(errors).toEqual([]);
});
