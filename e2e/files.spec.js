import { test, expect } from '@playwright/test';

// Both viewport projects share one database, so each test uses its own company per project.
const company = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const TEST_VIRUS = 'ERP-TEST-VIRUS-SIGNATURE-1b6f1c52-DO-NOT-STORE';
const pdf = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${extra}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
// A real 2x2 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHhgCAh6X4CYAAAAASUVORK5CYII=', 'base64');

const headers = (roles, companyId, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': companyId, 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}` });

/** A company with settings, the financial year 2026-27 and a numbering series for sample documents. */
async function prepare(request, companyId) {
  const h = (roles = 'SYSADM', user = 'e2e-sys') => headers(roles, companyId, user);
  expect((await request.put('/api/v1/core/company-settings', { headers: h(), data: { legalName: `Files Test ${companyId}`, reason: 'initial set-up' } })).status()).toBe(200);
  expect((await request.post('/api/v1/core/financial-years', { headers: h(), data: { startDate: '2026-04-01' } })).status()).toBe(201);
  const s = await request.post('/api/v1/core/number-series', { headers: h(), data: { docType: 'SAMPLE_DOC', name: 'Sample documents', prefix: 'SMP', format: '{PREFIX}/{FY}/{SEQ:4}', gapFree: false, resetRule: 'financial_year', reason: 'initial set-up' } });
  expect(s.status()).toBe(201);
}

async function open(page, roles, path, companyId, user = 'e2e-files') {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: companyId });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(path);
  return errors;
}

const noOverflow = async (page) => {
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};

async function newDocument(page, title) {
  await page.getByRole('button', { name: 'New sample document' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New sample document' });
  await dlg.getByLabel('Title').fill(title);
  await dlg.getByLabel(/^Document date/).fill('2026-10-15');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(/^Created SMP\//)).toBeVisible();
  await expect(page.getByTestId('attachments-panel')).toBeVisible();
}

test('AC-01 upload by drag-and-drop style input: progress, scan, preview and a short-lived link that really downloads', async ({ page, request }, info) => {
  const companyId = company(info, '61', '62');
  await prepare(request, companyId);
  const errors = await open(page, 'PM', '/admin/sample-documents', companyId, 'e2e-pm');
  await expect(page.getByRole('heading', { name: 'Sample Documents', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No sample documents yet' })).toBeVisible();
  await newDocument(page, 'Foundation memo');
  await expect(page.getByRole('heading', { name: 'No attachments yet' })).toBeVisible();

  await page.getByTestId('file-input').setInputFiles([
    { name: 'memo.pdf', mimeType: 'application/pdf', buffer: pdf('memo') },
    { name: 'site photo.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(page.getByTestId('file-memo.pdf')).toBeVisible();
  await expect(page.getByTestId('scan-memo.pdf')).toHaveText('Clean', { timeout: 20_000 });
  await expect(page.getByTestId('scan-site photo.png')).toHaveText('Clean', { timeout: 20_000 });
  await expect(page.getByAltText('Preview of site photo.png')).toBeVisible({ timeout: 10_000 });
  expect(await page.getByAltText('Preview of site photo.png').getAttribute('src')).toMatch(/v=thumbnail/);

  const popupPromise = page.waitForEvent('popup');
  const linkResponse = page.waitForResponse((r) => /\/files\/\d+\/url\?/.test(r.url()));
  await page.getByRole('button', { name: 'Open memo.pdf' }).click();
  const popup = await popupPromise; // the file opens in a new window
  const url = (await (await linkResponse).json()).data.url;
  expect(url).toMatch(/\/api\/v1\/core\/files\/\d+\/content\?exp=\d+&v=file&d=inline&sig=/);
  const dl = await request.get(url);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-type']).toBe('application/pdf');
  expect((await dl.body()).equals(pdf('memo'))).toBe(true);
  const tampered = await request.get(url.replace(/exp=\d+/, 'exp=99999999999'));
  expect(tampered.status()).toBe(403);
  await popup.close();

  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-03 bad files are refused with a clear message: wrong type, a program renamed to .pdf', async ({ page, request }, info) => {
  const companyId = company(info, '63', '64');
  await prepare(request, companyId);
  await open(page, 'PM', '/admin/sample-documents', companyId, 'e2e-pm');
  await newDocument(page, 'Bad uploads');
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(0x3a), Buffer.from([0x80, 0, 0, 0]), Buffer.alloc(0x40), Buffer.from('PE\0\0'), Buffer.from('This program cannot be run in DOS mode.')]);
  await page.getByTestId('file-input').setInputFiles([{ name: 'setup.exe', mimeType: 'application/octet-stream', buffer: exe }]);
  await expect(page.getByTestId('upload-setup.exe')).toContainText('.exe are not allowed');
  await page.getByTestId('file-input').setInputFiles([{ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: exe }]);
  await expect(page.getByTestId('upload-invoice.pdf')).toContainText('Windows program renamed to .pdf');
  await expect(page.getByTestId('upload-invoice.pdf').getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No attachments yet' })).toBeVisible();
});

test('T-01 a file that fails the virus scan is quarantined, cannot be opened, and shows on the administrator overview', async ({ page, request }, info) => {
  const companyId = company(info, '65', '66');
  await prepare(request, companyId);
  await open(page, 'SYSADM', '/admin/sample-documents', companyId, 'e2e-sys');
  await newDocument(page, 'Scan test');
  await page.getByTestId('file-input').setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(`site notes\n${TEST_VIRUS}\n`) }]);
  await expect(page.getByTestId('scan-notes.txt')).toHaveText('Quarantined', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Open notes.txt' })).toBeDisabled();
  await expect(page.getByText('failed the virus scan and cannot be opened')).toBeVisible();
  await page.getByRole('link', { name: 'File Storage' }).click();
  await expect(page.getByRole('heading', { name: 'File Storage Settings' })).toBeVisible();
  await expect(page.getByTestId('tile-infected')).toHaveText('1');
  await expect(page.getByTestId('attention-notes.txt')).toContainText('Quarantined');
  await expect(page.getByTestId('scanner-note')).toContainText('Only the built-in test-signature scanner is active');
  await noOverflow(page);
});

test('FR-02 a large file goes up in chunks, then a new version replaces it; submitting locks the record so files cannot be removed', async ({ page, request }, info) => {
  const companyId = company(info, '67', '68');
  await prepare(request, companyId);
  const errors = await open(page, 'PM', '/admin/sample-documents', companyId, 'e2e-pm');
  await newDocument(page, 'Drawing set');
  const big = Buffer.concat([pdf('drawings'), Buffer.alloc(6 * 1024 * 1024, 0x20)]);
  await page.getByTestId('file-input').setInputFiles([{ name: 'drawings.pdf', mimeType: 'application/pdf', buffer: big }]);
  await expect(page.getByTestId('scan-drawings.pdf')).toHaveText('Clean', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Replace drawings.pdf with a new version' }).click();
  await expect(page.getByText('Drop the new version of drawings.pdf here')).toBeVisible();
  await page.getByTestId('file-input').setInputFiles([{ name: 'drawings v2.pdf', mimeType: 'application/pdf', buffer: pdf('revised') }]);
  await expect(page.getByTestId('scan-drawings v2.pdf')).toHaveText('Clean', { timeout: 20_000 });
  await expect(page.getByTestId('file-drawings v2.pdf')).toContainText('v2');
  await expect(page.getByTestId('file-drawings.pdf')).toContainText('replaced');

  await page.getByRole('button', { name: /^Submit SMP\// }).click();
  await expect(page.getByText(/Its files are now locked/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove drawings v2.pdf' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('Removing a file asks for a reason and hides it from the record', async ({ page, request }, info) => {
  const companyId = company(info, '69', '70');
  await prepare(request, companyId);
  await open(page, 'PM', '/admin/sample-documents', companyId, 'e2e-pm');
  await newDocument(page, 'Removable');
  await page.getByTestId('file-input').setInputFiles([{ name: 'temp.pdf', mimeType: 'application/pdf', buffer: pdf('temp') }]);
  await expect(page.getByTestId('scan-temp.pdf')).toHaveText('Clean', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Remove temp.pdf' }).click();
  const dlg = page.getByRole('dialog', { name: 'Remove temp.pdf' });
  await dlg.getByLabel(/Reason/).fill('attached by mistake');
  await dlg.getByRole('button', { name: 'Remove file' }).click();
  await expect(page.getByText('temp.pdf was removed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No attachments yet' })).toBeVisible();
});

test('FR-08 the camera button is there on a phone-sized screen and asks for the rear camera', async ({ page, request }, info) => {
  const companyId = company(info, '71', '72');
  await prepare(request, companyId);
  await open(page, 'PM', '/admin/sample-documents', companyId, 'e2e-pm');
  await newDocument(page, 'Camera');
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
  const cam = page.getByTestId('camera-input');
  await expect(cam).toHaveAttribute('capture', 'environment');
  await expect(cam).toHaveAttribute('accept', 'image/*');
  await page.getByTestId('camera-input').setInputFiles([{ name: 'camera.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(page.getByTestId('scan-camera.png')).toHaveText('Clean', { timeout: 20_000 });
});

test('AC-06 file settings: SYSADM asks, ITADM approves, and the limit changes; PM has no access', async ({ page, request }, info) => {
  const companyId = company(info, '73', '74');
  await prepare(request, companyId);
  const errors = await open(page, 'SYSADM', '/admin/file-storage', companyId, 'e2e-sys');
  await expect(page.getByRole('heading', { name: 'File Storage Settings' })).toBeVisible();
  await expect(page.getByTestId('setting-document')).toContainText('50');
  await page.getByRole('button', { name: 'Request a change' }).click();
  const dlg = page.getByRole('dialog', { name: 'Request a change to the file settings' });
  await dlg.locator('input[name="size-document"]').fill('77');
  await dlg.getByLabel('Download link life (seconds)').fill('90');
  await dlg.getByLabel(/Reason/).fill('larger contracts are now attached');
  await dlg.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText(/sent for approval by the IT Administrator/)).toBeVisible();
  await expect(page.getByTestId('setting-document')).toContainText('50');
  await expect(page.getByText(/Waiting for ITADM/)).toBeVisible();

  const it = await page.context().newPage();
  await open(it, 'ITADM', '/admin/file-storage', companyId, 'e2e-it');
  await it.getByRole('button', { name: /^Approve request/ }).first().click();
  await expect(it.getByText(/approved and applied/)).toBeVisible();
  await expect(it.getByTestId('setting-document')).toContainText('77');
  await expect(it.getByTestId('current-settings')).toContainText('90 seconds');
  await noOverflow(it);

  const pm = await page.context().newPage();
  await open(pm, 'PM', '/admin/file-storage', companyId, 'e2e-pm');
  await expect(pm.getByRole('heading', { name: 'You do not have access to the file overview' })).toBeVisible();
  expect(errors.filter((e) => !/403/.test(e))).toEqual([]);
});
