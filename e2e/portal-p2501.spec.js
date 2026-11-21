import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { toPdf } from '../src/server/platform/export/index.js';
import { todayIST } from '../src/shared/dates.js';
import { counterAt, totpAt } from '../src/server/platform/identity/totp.js';

const portal = '/api/v1/portal';
const buyer = { 'x-erp-user': 'portal-buyer', 'x-erp-roles': 'PROCMGR' };

async function screenshot(page, info, name) {
  const output = name.startsWith('supplier-') ? process.env.ERP_SUPPLIER_SCREENSHOTS : process.env.ERP_PORTAL_SCREENSHOTS;
  if (!output) return;
  const folder = resolve(output);
  mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: resolve(folder, `${info.project.name}-${name}.png`), fullPage: true });
}

test('external portal sign-in, account workflows and supplier transactions fit the viewport', async ({ page, request }, info) => {
  test.setTimeout(90000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const suffix = info.project.name;
  const companyId = Number(db.prepare('INSERT INTO org_companies (code, legal_name, short_name) VALUES (?, ?, ?)')
    .run(`PTL-${suffix}`, 'Portal site test company', 'Portal test company').lastInsertRowid);
  db.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES ('ff.portal.p2501', ?, 'Portal browser fixture', 0, 1)`).run(companyId);
  const sign = db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (?, ?, ?, 'PASSED', 'browser-test', '2026-11-20T00:00:00Z')`);
  sign.run(companyId, 'G1', 'Platform Gate');
  sign.run(companyId, 'G2', 'Workforce-First Gate');
  const partnerId = Number(db.prepare(`INSERT INTO mdm_partners (company_id, code, legal_name, constitution, steward_role, partner_status)
    VALUES (?, ?, 'Browser test supplier', 'OTHER', 'PROCMGR', 'ACTIVE')`).run(companyId, `BP-${suffix}`).lastInsertRowid);
  db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, 'VENDOR')").run(companyId, partnerId);
  const contactId = Number(db.prepare('INSERT INTO mdm_partner_contacts (company_id, partner_id, name) VALUES (?, ?, ?)')
    .run(companyId, partnerId, 'Supplier contact').lastInsertRowid);

  for (const flag of ['ff.portal.p2502', 'ff.proc.p1503', 'ff.proc.p1505']) {
    db.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
      VALUES (?, ?, 'Supplier browser fixture', 0, 1)`).run(flag, companyId);
  }
  const today = todayIST();
  const projectId = Number(db.prepare(`INSERT INTO org_projects (company_id, code, name, type, status)
    VALUES (?, 'SUPPLY', 'Supplier browser project', 'ROAD', 'ACTIVE')`).run(companyId).lastInsertRowid);
  const prId = Number(db.prepare(`INSERT INTO proc_requisitions
    (company_id, doc_no, doc_date, org_project_id, required_by, pr_source, requested_by, status)
    VALUES (?, 'PR/PORTAL/1', ?, ?, ?, 'DIRECT', 'portal-buyer', 'APPROVED')`).run(companyId, today, projectId, today).lastInsertRowid);
  const prLine = Number(db.prepare(`INSERT INTO proc_pr_lines
    (company_id, pr_id, line_no, service_desc, qty, uom, required_by)
    VALUES (?, ?, 1, 'Site aggregates', 2500, 't', ?)`).run(companyId, prId, today).lastInsertRowid);
  const rfqId = Number(db.prepare(`INSERT INTO proc_rfqs
    (company_id, doc_no, doc_date, org_project_id, title, due_date, status, requested_by)
    VALUES (?, 'RFQ/PORTAL/1', ?, ?, 'Site aggregates', '2099-12-01', 'ISSUED', 'portal-buyer')`)
    .run(companyId, today, projectId).lastInsertRowid);
  db.prepare(`INSERT INTO proc_rfq_lines (company_id, rfq_id, line_no, pr_line_id, service_desc, qty, uom)
    VALUES (?, ?, 1, ?, 'Site aggregates', 2500, 't')`).run(companyId, rfqId, prLine);
  db.prepare('INSERT INTO proc_rfq_vendors (company_id, rfq_id, vendor_id) VALUES (?, ?, ?)').run(companyId, rfqId, partnerId);
  const poId = Number(db.prepare(`INSERT INTO proc_purchase_orders
    (company_id, doc_no, doc_date, org_project_id, vendor_id, status, requested_by)
    VALUES (?, 'PO/PORTAL/1', ?, ?, ?, 'APPROVED', 'portal-buyer')`).run(companyId, today, projectId, partnerId).lastInsertRowid);
  db.prepare(`INSERT INTO proc_po_lines (company_id, po_id, line_no, description, qty, uom, balance_qty)
    VALUES (?, ?, 1, 'Site aggregates', 2500, 't', 2500)`).run(companyId, poId);
  const orderLine = db.prepare('SELECT id FROM proc_po_lines WHERE po_id = ?').get(poId).id;
  const storeId = Number(db.prepare(`INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, requested_by)
    VALUES (?, 'PORTAL-STORE', 'Portal store', 'CENTRAL_WAREHOUSE', ?, 'portal-buyer')`).run(companyId, projectId).lastInsertRowid);
  const category = Number(db.prepare(`INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, steward_role, category_status)
    VALUES (?, 'PORTAL-MAT', 'Aggregate', 'PMA', 'PROCMGR', 'ACTIVE')`).run(companyId).lastInsertRowid);
  const item = Number(db.prepare(`INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status)
    VALUES (?, 'PORTAL-ITEM', 'Aggregate', 'MATERIAL', ?, 't', ?, 'ACTIVE')`).run(companyId, category, today).lastInsertRowid);
  const grn = Number(db.prepare(`INSERT INTO inv_grns
    (company_id, doc_no, received_date, org_project_id, store_id, po_id, vendor_id, status, requested_by)
    VALUES (?, 'GRN/PORTAL/1', ?, ?, ?, ?, ?, 'APPROVED', 'portal-buyer')`)
    .run(companyId, today, projectId, storeId, poId, partnerId).lastInsertRowid);
  db.prepare(`INSERT INTO inv_grn_lines (company_id, grn_id, line_no, po_line_id, item_id, uom, received_qty, accepted_qty)
    VALUES (?, ?, 1, ?, ?, 't', 2000, 2000)`).run(companyId, grn, orderLine, item);
  db.prepare(`INSERT INTO iam_users (company_id, username, display_name, roles_json)
    VALUES (?, ?, 'Accounts manager', ?)`).run(companyId, `portal-accounts-${suffix}`, JSON.stringify(['ACCMGR']));
  const vdrId = Number(db.prepare(`INSERT INTO engg_vdr_items
    (company_id, vdr_no, org_project_id, po_ref, vendor, doc_type, title, due_date)
    VALUES (?, 'VDR-PORTAL-001', ?, 'PO/PORTAL/1', 'Browser test supplier', 'DATA_SHEET', 'Aggregate test certificate', '2099-12-01')`)
    .run(companyId, projectId).lastInsertRowid);
  db.prepare('INSERT INTO ptl_vdr_orders (item_id, po_id) VALUES (?, ?)').run(vdrId, poId);
  db.prepare(`INSERT INTO vnd_scorecards (company_id, partner_id, period, period_from, period_to, computed_at, total_score, rating)
    VALUES (?, ?, '2026-11', '2026-11-01', '2026-11-30', ?, 930000, 'A')`).run(companyId, partnerId, today);
  async function attach(label, filename) {
    const file = toPdf({ columns: [], rows: [], title: filename });
    await page.getByLabel(label, { exact: true }).setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: file });
    await expect(page.getByText(`${filename} · Ready to submit`, { exact: true })).toBeVisible({ timeout: 22_000 });
  }

  try {
    const invite = await request.post(`${portal}/admin/invitations`, {
      headers: { ...buyer, 'x-erp-company': String(companyId) },
      data: { partnerId, contactId, portalType: 'X-SUP' },
    });
    expect(invite.status()).toBe(201);
    const { data: invitation } = await invite.json();
    const assertFits = async () => expect(await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Partner portal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await assertFits();
    if (info.project.name === 'desktop') {
      const viewport = page.viewportSize();
      for (const width of [768, 1920]) {
        await page.setViewportSize({ width, height: viewport.height });
        await assertFits();
      }
      await page.setViewportSize(viewport);
    }
    await screenshot(page, info, 'portal-login-registration');
    await expect(page).toHaveScreenshot('portal-login.png', { animations: 'disabled', caret: 'hide' });
    await page.getByLabel('Large text').check();
    for (const theme of ['dark', 'high-contrast']) {
      await page.getByLabel('Theme').selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await assertFits();
      expect(await page.locator('main :is(h1, h2, button)').evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
    }
    await page.getByLabel('Theme').selectOption('light');
    await page.getByLabel('Language').selectOption('hi');
    await expect(page.getByRole('heading', { name: 'साझेदार पोर्टल' })).toBeVisible();
    await page.getByLabel('Language').selectOption('te');
    await expect(page.getByRole('heading', { name: 'భాగస్వామి పోర్టల్' })).toBeVisible();
    await assertFits();
    await page.getByLabel('Language').selectOption('en');
    await page.getByLabel('Large text').uncheck();

    await page.getByRole('button', { name: 'Register as a vendor' }).click();
    await expect(page.getByLabel('Legal business name')).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'portal-vendor-registration');

    await page.goto(`/portal#invite=${invitation.token}`);
    await page.reload();
    await page.getByRole('button', { name: 'Set up account' }).click();
    const secret = await page.locator('code').textContent();
    const countdown = (Date.now() % 30000);
    if (countdown > 23000) await new Promise((resolve) => setTimeout(resolve, 31000 - countdown));
    const step = counterAt(Date.now());
    const password = 'Browser fixture long passphrase 2049!';
    await page.getByLabel('New password').fill(password);
    await page.getByLabel('Authenticator code').fill(totpAt(secret, step - 1));
    await page.getByRole('checkbox', { name: /I agree/ }).check();
    await page.getByRole('button', { name: 'Activate account' }).click();
    await expect(page.getByRole('status')).toContainText('Account activated');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Authenticator code').fill(totpAt(secret, step));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Browser test supplier' })).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'portal-home');
    await page.getByRole('button', { name: 'My company' }).click();
    await page.getByLabel('Subject').fill('Trading name request');
    await page.getByLabel('Requested changes').fill('Please review our trading name.');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('status')).toContainText('Request received');
    await assertFits();
    await screenshot(page, info, 'portal-company');
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Trading name request' })).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'portal-inbox');
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await expect(page.getByText('No documents have been shared with this account.')).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'portal-documents');
    await page.getByRole('button', { name: 'RFQs & Quotations', exact: true }).click();
    await page.getByRole('button', { name: 'RFQ/PORTAL/1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'RFQ/PORTAL/1', exact: true })).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'supplier-rfq');
    await expect(page).toHaveScreenshot('supplier-rfq.png', { fullPage: true, animations: 'disabled', caret: 'hide' });
    const originalViewport = page.viewportSize();
    for (const width of info.project.name === 'mobile' ? [360] : [768, 1280, 1920]) {
      await page.setViewportSize({ ...originalViewport, width });
      await assertFits();
    }
    await page.setViewportSize(originalViewport);
    await page.getByLabel('Large text').check();
    for (const theme of ['dark', 'high-contrast']) {
      await page.getByLabel('Theme').selectOption(theme);
      await assertFits();
    }
    await page.getByLabel('Theme').selectOption('light');
    await page.getByLabel('Large text').uncheck();
    for (const [language, heading] of [['hi', 'मूल्य अनुरोध और कोटेशन'], ['te', 'ధర అభ్యర్థనలు మరియు కొటేషన్లు']]) {
      await page.getByLabel('Language').selectOption(language);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await assertFits();
    }
    await page.getByLabel('Language').selectOption('en');
    await page.getByLabel('Quotation reference').fill('BROWSER-QUOTE');
    await page.getByLabel('Valid until').fill('2099-12-01');
    await page.getByLabel('Offered quantity').fill('2.5');
    await page.getByLabel('Unit rate').fill('100');
    await attach('Quotation attachment', 'portal-quotation.pdf');
    await page.getByRole('button', { name: 'Submit quotation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Send revised quotation' })).toBeVisible();
    await expect(page.getByLabel('Quotation reference')).toHaveValue('BROWSER-QUOTE');
    await page.getByRole('button', { name: 'Purchase Orders & ASN', exact: true }).click();
    await page.getByRole('button', { name: 'PO/PORTAL/1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'PO/PORTAL/1', exact: true })).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'supplier-order');
    await expect(page).toHaveScreenshot('supplier-order.png', { fullPage: true, animations: 'disabled', caret: 'hide' });
    await page.getByRole('button', { name: 'Acknowledge order' }).click();
    await expect(page.getByText(/Acknowledged on/)).toBeVisible();
    await page.getByLabel('Dispatch date').fill(today);
    await page.getByLabel('Dispatched quantity for line 1').fill('1');
    await attach('Dispatch invoice copy (PDF)', 'portal-dispatch.pdf');
    await page.getByRole('button', { name: 'Record dispatch' }).click();
    await expect(page.getByText('The dispatch is recorded. Thank you.')).toBeVisible();
    await page.getByRole('button', { name: 'Invoices and payments', exact: true }).click();
    await page.getByRole('button', { name: 'PO/PORTAL/1', exact: true }).click();
    await expect(page.getByLabel('GST invoice number')).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'supplier-invoice');
    await page.getByLabel('GST invoice number').fill('PORTAL-INV-1');
    await page.getByLabel('Invoice date', { exact: true }).fill(today);
    await page.getByLabel('Total shown on invoice').fill('0');
    await page.getByLabel('Invoiced quantity').fill('1');
    if (info.project.name === 'mobile') {
      const camera = page.getByLabel('Take a photo', { exact: true });
      await expect(camera).toHaveAttribute('capture', 'environment');
      const photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).jpeg().toBuffer();
      await camera.setInputFiles({ name: 'invoice-photo.jpg', mimeType: 'image/jpeg', buffer: photo });
      await expect(page.getByText('invoice-photo.pdf · Ready to submit', { exact: true })).toBeVisible({ timeout: 22_000 });
    } else {
      await attach('Invoice PDF', 'portal-invoice.pdf');
    }
    await page.getByRole('button', { name: 'Send invoice for approval' }).click();
    await expect(page.getByText('PORTAL-INV-1', { exact: true })).toBeVisible();
    await expect(page.getByText(/SUBMITTED · MATCHED/)).toBeVisible();

    await page.getByRole('button', { name: 'Vendor document review', exact: true }).click();
    await page.getByRole('button', { name: 'PO/PORTAL/1', exact: true }).click();
    await attach('Vendor document', 'portal-vendor-document.pdf');
    await page.getByRole('button', { name: 'Submit vendor document' }).click();
    await expect(page.getByText(/RECEIVED · Due/)).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'supplier-vdr');

    await page.getByRole('button', { name: 'Compliance documents', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Submit a renewal' })).toBeVisible();
    await page.getByLabel('Document type').selectOption('INSURANCE');
    await page.getByLabel('Document reference').fill('POLICY-PORTAL-1');
    await page.getByLabel('Valid from').fill(today);
    await page.getByLabel('Valid until').fill('2099-12-01');
    await attach('Renewed compliance document', 'portal-compliance.pdf');
    await page.getByRole('button', { name: 'Send for verification' }).click();
    await expect(page.getByText('Insurance · POLICY-PORTAL-1')).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'supplier-compliance');

    await page.getByRole('button', { name: 'My Scorecard', exact: true }).click();
    await expect(page.getByRole('heading', { name: '2026-11' })).toBeVisible();
    await expect(page.getByText('93% · A', { exact: true })).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'supplier-scorecard');

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();

    await page.addInitScript((company) => {
      localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'portal-admin', roles: 'SYSADM', company }));
    }, String(companyId));
    await page.goto('/admin/portal-users');
    await expect(page.getByRole('heading', { name: 'Portal users' })).toBeVisible();
    await expect(page.getByText(invitation.account, { exact: true })).toBeVisible();
    await assertFits();
    await screenshot(page, info, 'portal-users');
    expect(pageErrors).toEqual([]);
  } finally {
    db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.portal.p2501' AND company_id = ?").run(companyId);
    db.close();
  }
});
