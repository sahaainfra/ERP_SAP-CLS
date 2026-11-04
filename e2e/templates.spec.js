import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.11: the template library and editor (a new version of the tax invoice format, checked against the variable catalogue, previewed, sent for approval and approved by
// the process owner), and the generated documents log (generate from approved data, open, deliver, a new version with a reason, a person without the right).
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const as = async (browser, info, company, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
  return page;
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
async function company(request, code) {
  const post = async (path, data) => {
    const res = await request.post(`/api/v1${path}`, { headers: H('SYSADM', 1, 'e2e-setup'), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const id = (await post('/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  expect((await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } })).status()).toBeLessThan(300);
  return id;
}
const api = async (request, c, roles, user, method, path, data, ok = true) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  if (ok) expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return ok ? (await res.json()).data : res;
};
const invoice = (docNo) => ({ docNo, docDate: '2026-11-04', party: { name: 'MSRDC', gstin: '27AAAJM0000B1ZP', address: 'Mumbai', stateCode: '27' }, supply: { stateCode: '27' }, lines: [{ description: 'Bituminous concrete', hsn: '9954', uom: 'Cum', qty: '850.250', rate: '9120.5000', gstRate: '18' }] });

test('AC-01 AC-02 FR-01 FR-03 BR-01 the library, a new version of the tax invoice format: refused with an unknown variable, previewed, sent for approval, approved by the CFO and then the active one', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const c = await company(request, `TPL${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys', '/admin/templates');
  const errors = watch(sys);
  await expect(sys.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible();
  await expect(sys.getByTestId('template-TAX_INVOICE_STANDARD-1')).toContainText('Active');
  await expect(sys.getByTestId('template-PO_STANDARD-1')).toBeVisible();
  await noOverflow(sys);
  await sys.getByLabel('Document type').first().selectOption('PAYSLIP');
  await expect(sys.getByTestId('template-table').locator('tbody tr')).toHaveCount(1);
  await sys.getByLabel('Document type').first().selectOption('TAX_INVOICE');
  await sys.getByRole('link', { name: 'TAX_INVOICE_STANDARD' }).click();
  await expect(sys.getByTestId('template-editor')).toBeVisible();
  await expect(sys.getByRole('heading', { level: 1 })).toContainText('TAX_INVOICE_STANDARD version 1');
  await expect(sys.getByTestId('check-result')).toContainText('passes the check', { timeout: 20_000 });
  await sys.getByTestId('new-version').click();
  await expect(sys.getByRole('heading', { level: 1 })).toContainText('version 2', { timeout: 20_000 });
  // an unknown variable is refused as you type, with the line and the reason; Save is off
  const html = sys.getByTestId('html-editor');
  const before = await html.inputValue();
  await html.fill(`${before}\n<p>{{customerName}}</p>`);
  await expect(sys.getByTestId('check-result')).toContainText('not in the catalogue of Tax invoice', { timeout: 20_000 });
  await expect(sys.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  await noOverflow(sys);
  // the picker puts a real variable in; the check passes and the server draws a preview of the sample record
  await html.fill(before.replace('<h1 class="title">', '<h1 class="title">OUR '));
  await sys.getByTestId('var-list').getByRole('button', { name: 'bankDetails', exact: true }).click();
  await expect(sys.getByTestId('check-result')).toContainText('passes the check', { timeout: 20_000 });
  await sys.getByTestId('preview-now').click();
  await expect(sys.getByTestId('preview-page-1')).toBeVisible({ timeout: 30_000 });
  await expect(sys.getByTestId('preview-pages')).toContainText('page(s)');
  await sys.getByLabel('What changed').fill('Our own heading');
  await sys.getByRole('button', { name: 'Save draft' }).click();
  await expect(sys.getByTestId('te-notice')).toContainText('Draft saved');
  await sys.getByRole('button', { name: 'Send for approval' }).click();
  await expect(sys.getByTestId('te-notice')).toContainText('Sent for approval');
  const t = (await api(request, c, 'SYSADM', 'e2e-sys', 'get', '/tpl/templates?docType=TAX_INVOICE')).rows.find((r) => r.version === 2);
  expect(t.status).toBe('IN_REVIEW');
  // the system administrator cannot approve; the CFO, the process owner of invoices, does
  const tasks = (await api(request, c, 'CFO', 'e2e-cfo', 'get', '/workflow/tasks?mine=assigned')).rows;
  const task = tasks.find((x) => x.instance.id === t.instanceId);
  expect(task).toBeTruthy();
  await api(request, c, 'CFO', 'e2e-cfo', 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'Checked' });
  await sys.goto('/admin/templates');
  await expect(sys.getByTestId('template-TAX_INVOICE_STANDARD-2')).toContainText('Active');
  expect(errors).toEqual([]);
});

test('AC-01 AC-02 AC-03 FR-04 FR-05 FR-06 generate a tax invoice from approved data, open it, send it, make a new version with a reason; a person without the right sees nothing', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const c = await company(request, `GEN${info.project.name === 'mobile' ? 'M' : 'D'}`);
  await api(request, c, 'SYSADM', 'e2e-sys', 'put', '/tpl/records', { docType: 'TAX_INVOICE', entityId: 'inv-1', data: invoice('INV/2026-27/0101'), approved: true });
  await api(request, c, 'SYSADM', 'e2e-sys', 'put', '/tpl/records', { docType: 'TAX_INVOICE', entityId: 'inv-2', data: invoice('INV/2026-27/0102'), approved: true });
  const acc = await as(browser, info, c, 'ACCMGR', 'e2e-acc', '/documents/generated');
  const errors = watch(acc);
  await expect(acc.getByRole('heading', { name: 'Generated Documents', level: 1 })).toBeVisible();
  await expect(acc.getByTestId('empty-state')).toBeVisible();
  await noOverflow(acc);
  await acc.getByTestId('gen-type').selectOption('TAX_INVOICE');
  await acc.getByLabel('Choose INV/2026-27/0101').check();
  await acc.getByTestId('gen-one').click();
  await expect(acc.getByTestId('generated-detail')).toBeVisible({ timeout: 30_000 });
  await expect(acc.getByTestId('generated-detail')).toContainText('INV/2026-27/0101');
  await expect(acc.getByTestId('verify-code')).toHaveText(/^[A-Z2-9]{12}$/);
  await noOverflow(acc);
  // opening the PDF works with the person's own sign-in
  const [popup] = await Promise.all([acc.waitForEvent('popup'), acc.getByTestId('open-pdf').click()]);
  await popup.close();
  // delivery by the portal is recorded and waits for the portal; the log shows it
  await acc.getByLabel('How').selectOption('PORTAL');
  await acc.getByTestId('deliver-to').fill('msrdc-portal');
  await acc.getByTestId('deliver-send').click();
  await expect(acc.getByTestId('gd-notice')).toContainText('1 delivery');
  await expect(acc.getByTestId('delivery-table')).toContainText('msrdc-portal');
  // a new version needs a reason
  await expect(acc.getByRole('button', { name: 'Generate a new version' })).toBeDisabled();
  await acc.getByTestId('regen-reason').fill('The bank details were corrected');
  await acc.getByRole('button', { name: 'Generate a new version' }).click();
  await expect(acc.getByTestId('generated-detail')).toContainText('version 2', { timeout: 30_000 });
  await expect(acc.getByTestId('generated-detail')).toContainText('The bank details were corrected');
  // two documents are made together as a background job
  await acc.goto('/documents/generated');
  await acc.getByTestId('gen-type').selectOption('TAX_INVOICE');
  await acc.getByLabel('Choose INV/2026-27/0102').check();
  await acc.getByTestId('gen-one').click();
  await expect(acc.getByTestId('generated-detail')).toContainText('INV/2026-27/0102', { timeout: 30_000 });
  await acc.goto('/documents/generated');
  await expect(acc.getByTestId('generated-table').locator('tbody tr')).toHaveCount(3);
  await expect(acc.getByTestId('gl-summary')).toContainText('Tax invoice');
  const csv = await api(request, c, 'ACCMGR', 'e2e-acc', 'get', '/tpl/generated?limit=25');
  expect(csv.total).toBe(3);
  await noOverflow(acc);
  // a person without the right gets the no-permission state
  const emp = await as(browser, info, c, 'EMP', 'e2e-emp', '/documents/generated');
  await expect(emp.getByTestId('no-permission')).toBeVisible();
  const lib = await as(browser, info, c, 'EMP', 'e2e-emp', '/admin/templates');
  await expect(lib.getByTestId('no-permission')).toBeVisible();
  expect(errors).toEqual([]);
});
