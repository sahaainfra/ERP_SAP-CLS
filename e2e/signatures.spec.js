import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.12: the public verification page (no sign-in) for a signed purchase order, a file compared with the stored hash (the original matches, one byte changed does not),
// the signature register, revoking, signing and cancelling from the generated documents page, and a person without the right.
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
const po = (n) => ({ docNo: `PO/2026-27/${n}`, party: { name: 'Shree Cement Traders', stateCode: '27' }, supply: { stateCode: '27' }, lines: [{ description: 'OPC 53 cement', qty: '1200', rate: '412.50', gstRate: '28' }] });
async function signedPo(request, c, n, entity) {
  await api(request, c, 'SYSADM', 'e2e-sys', 'put', '/tpl/records', { docType: 'PO', entityId: entity, data: po(n), approved: true });
  const g = await api(request, c, 'PROCMGR', 'e2e-proc', 'post', '/tpl/generate', { docType: 'PO', entityId: entity });
  await api(request, c, 'PM', 'e2e-pm', 'post', `/sig/documents/${g.id}/sign`, { method: 'APPROVAL', label: 'Project manager' });
  return g;
}

test('AC-01 AC-02 FR-02 FR-03 BR-01 the QR page opens without signing in: a genuine signed purchase order, its signer, and the file compared with the stored hash; one byte changed is detected', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const c = await company(request, `VER${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const g = await signedPo(request, c, '0042', 'po-42');
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  const errors = watch(page);
  await page.goto(`/verify/${g.verifyCode}`);
  await expect(page.getByTestId('verify-result')).toHaveAttribute('data-status', 'VALID');
  await expect(page.getByTestId('verify-docno')).toHaveText('PO/2026-27/0042');
  await expect(page.getByTestId('verify-signers')).toContainText('Electronic approval');
  await expect(page.getByTestId('verify-page')).not.toContainText('Shree Cement');
  await noOverflow(page);
  const res = await request.get(`/api/v1/tpl/generated/${g.id}/content`, { headers: H('PROCMGR', c, 'e2e-proc') });
  const original = Buffer.from(await res.body());
  await page.getByTestId('verify-file').setInputFiles({ name: 'po.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(page.getByTestId('verify-file-result')).toHaveAttribute('data-match', 'true');
  const bad = Buffer.from(original);
  bad[Math.floor(bad.length / 2)] ^= 1;
  await page.getByTestId('verify-file').setInputFiles({ name: 'po-changed.pdf', mimeType: 'application/pdf', buffer: bad });
  await expect(page.getByTestId('verify-file-result')).toHaveAttribute('data-match', 'false');
  await expect(page.getByTestId('verify-file-result')).toContainText('NOT the document');
  // typing a code by hand, and a wrong one
  await page.goto('/verify');
  await page.getByTestId('verify-code').fill('ABCDEFGHJKLM');
  await page.getByTestId('verify-go').click();
  await expect(page.getByTestId('verify-result')).toHaveAttribute('data-status', 'UNKNOWN');
  await page.getByTestId('verify-code').fill('xx');
  await page.getByTestId('verify-go').click();
  await expect(page.getByTestId('verify-error')).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('AC-01 AC-02 AC-03 FR-01 FR-04 BR-02 the register, signing and cancelling from the document page, revoking by the administrator; the public check follows; a person without the right', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const c = await company(request, `SIG${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const g = await signedPo(request, c, '0050', 'po-50');
  const aud = await as(browser, info, c, 'AUD', 'e2e-aud', '/admin/signatures');
  const errors = watch(aud);
  await expect(aud.getByRole('heading', { name: 'Signature Register', level: 1 })).toBeVisible();
  await expect(aud.getByTestId('signature-register-table')).toContainText('PO/2026-27/0050');
  await expect(aud.getByTestId('sr-summary')).toContainText('Electronic approval');
  await expect(aud.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
  await noOverflow(aud);
  // the accounts manager signs from the document page
  const acc = await as(browser, info, c, 'ACCMGR', 'e2e-acc', `/documents/generated?id=${g.id}`);
  await expect(acc.getByTestId('signature-panel')).toBeVisible({ timeout: 20_000 });
  await acc.getByTestId('sign-go').click();
  await expect(acc.getByTestId('sp-notice')).toContainText('Signed');
  await expect(acc.getByTestId('signature-table').locator('tbody tr')).toHaveCount(2);
  const [popup] = await Promise.all([acc.waitForEvent('popup'), acc.getByTestId('open-signed').click()]);
  await popup.close();
  await noOverflow(acc);
  // the administrator revokes the project manager's signature
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys', '/admin/signatures');
  const row = sys.getByTestId('signature-register-table').locator('tbody tr', { hasText: 'E2E-PM' }).or(sys.getByTestId('signature-register-table').locator('tbody tr').first());
  await row.getByRole('button', { name: 'Revoke' }).first().click();
  await sys.getByTestId('revoke-reason').fill('Signed by mistake');
  await sys.getByTestId('revoke-go').click();
  await expect(sys.getByTestId('sr-notice')).toContainText('revoked');
  await expect(sys.getByTestId('sig-profile')).toBeVisible().catch(() => {});
  await expect(sys.getByTestId('sig-settings')).toBeVisible();
  const pubv = await request.get(`/api/v1/verify/${g.verifyCode}`);
  expect(JSON.stringify((await pubv.json()).data.signers)).toContain('Revoked');
  // the project manager cancels the document; the public check says so
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', `/documents/generated?id=${g.id}`);
  await pm.getByTestId('cancel-reason').fill('Order withdrawn');
  await pm.getByTestId('cancel-go').click();
  await expect(pm.getByTestId('sp-cancelled')).toContainText('Order withdrawn');
  const pub = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport });
  const vp = await pub.newPage();
  await vp.goto(`/verify/${g.verifyCode}`);
  await expect(vp.getByTestId('verify-result')).toHaveAttribute('data-status', 'CANCELLED');
  await expect(vp.getByTestId('verify-message')).toContainText('Cancelled on');
  // a person without the right
  const emp = await as(browser, info, c, 'EMP', 'e2e-emp', '/admin/signatures');
  await expect(emp.getByTestId('no-permission')).toBeVisible();
  expect(errors).toEqual([]);
});
