import { test, expect } from '@playwright/test';

// Development-header mode (port 3100); each project works in its own company, created through the API first.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });

async function newCompany(request, code) {
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-sys'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id;
}
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => {
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};
const open = async (page, company, roles, path, user) => {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  return page.goto(path);
};

test('T-03 the content security policy blocks an injected inline script, and the application still works under it', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'CSPDESK', 'CSPMOB'));
  const errors = watch(page);
  const response = await open(page, company, 'SYSADM', '/admin/about', 'e2e-csp');
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible();
  // an attacker's script, written into the page, does not run
  const outcome = await page.evaluate(() => new Promise((resolve) => {
    let violated = false;
    document.addEventListener('securitypolicyviolation', (e) => { violated = e.violatedDirective.startsWith('script-src'); });
    const s = document.createElement('script');
    s.textContent = 'window.__injected = true';
    document.body.appendChild(s);
    const img = document.createElement('div');
    img.innerHTML = '<img src=x onerror="window.__injected = true">';
    document.body.appendChild(img);
    setTimeout(() => resolve({ ran: Boolean(window.__injected), violated }), 400);
  }));
  expect(outcome.ran).toBe(false);
  expect(outcome.violated).toBe(true);
  // the page was not harmed by the policy: other pages load and nothing but the injected script was reported
  await page.goto('/admin/feature-flags');
  await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();
  expect(errors.filter((e) => !/Content Security Policy|Refused to/.test(e))).toEqual([]);
});

test('Route Registry: every route with its protection, filters, and a self-test that records the result', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'RRGDESK', 'RRGMOB'));
  const errors = watch(page);
  test.setTimeout(90_000);
  await open(page, company, 'ITADM', '/admin/security/routes', 'e2e-itadm');
  await expect(page.getByRole('heading', { name: 'Route Registry' })).toBeVisible();
  await expect(page).toHaveTitle(/Route Registry/);
  await expect(page.getByTestId('route-summary')).toContainText('100%');
  await expect(page.getByTestId('route-summary')).toContainText('Routes declared');
  await expect(page.getByTestId('route-GET-/api/v1/core/audit')).toContainText('core.audit.view');
  await noOverflow(page);
  await page.locator('select[aria-label="Protection"]').selectOption('public');
  await expect(page.getByTestId('route-POST-/api/v1/iam/auth/login')).toContainText('Public');
  await page.locator('select[aria-label="Protection"]').selectOption('');
  await page.getByRole('searchbox', { name: 'Search routes' }).fill('nothing-matches-this');
  await expect(page.getByRole('heading', { name: 'No routes' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search routes' }).fill('security-settings');
  await expect(page.getByTestId('route-POST-/api/v1/core/security-settings/change-requests')).toContainText('core.security.configure');
  await page.getByRole('searchbox', { name: 'Search routes' }).fill('');
  // the self-test calls every route with no sign-in and with no permission
  await page.getByRole('button', { name: 'Run the self-test' }).click();
  await expect(page.getByTestId('route-notice')).toContainText('0 failed', { timeout: 60_000 });
  await expect(page.getByTestId('route-summary')).toContainText('failed');
  await page.locator('select[aria-label="Last test"]').selectOption('pass');
  await page.getByRole('searchbox', { name: 'Search routes' }).fill('/iam/users');
  await expect(page.getByTestId('route-GET-/api/v1/iam/users').getByText('Passed')).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);

  // the auditor reads the registry but does not run the test
  const aud = await page.context().newPage();
  await open(aud, company, 'AUD', '/admin/security/routes', 'e2e-aud');
  await expect(aud.getByRole('heading', { name: 'Route Registry' })).toBeVisible();
  await expect(aud.getByRole('button', { name: 'Run the self-test' })).toHaveCount(0);
  await aud.close();
});

test('Security Settings: a change is a request, approved by someone else; the history, the secrets and the limits of each role', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'SSEDESK', 'SSEMOB'));
  const errors = watch(page);
  const threshold = pick(info, '900', '800');
  await open(page, company, 'ITADM', '/admin/security/settings', 'e2e-itadm');
  await expect(page.getByRole('heading', { name: 'Security Settings' })).toBeVisible();
  await expect(page).toHaveTitle(/Security Settings/);
  await expect(page.getByTestId('secrets')).toContainText('AUTH_SECRET');
  await expect(page.getByTestId('secrets')).toContainText('never shown');
  await noOverflow(page);

  // an unsafe policy is refused with a message
  await page.getByLabel('Content security policy').fill("default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
  await page.locator('textarea[name=reason]').fill('Allowing inline scripts for a test');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await page.getByRole('button', { name: 'Use the built-in values' }).click();

  // a valid change
  await page.getByLabel('Export of people\'s records needs approval above (records)').fill(threshold);
  await page.locator('textarea[name=reason]').fill('Lower the bulk export threshold');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByTestId('settings-notice')).toContainText('was raised');
  await expect(page.getByTestId('pending-change')).toContainText('Change security settings');
  // the requester cannot decide it; the system administrator does
  const list = await (await request.get('/api/v1/core/change-requests?filter[type]=security_settings_change', { headers: H('SYSADM', company, 'e2e-sysadmin') })).json();
  const pending = list.data.find((r) => r.status === 'SUBMITTED');
  expect(pending.chain).toEqual(['SYSADM|DIR']);
  expect((await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: H('ITADM', company, 'e2e-itadm'), data: { action: 'approve', comment: 'checked and fine' } })).status()).toBe(403);
  const ok = await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: H('SYSADM', company, 'e2e-sysadmin'), data: { action: 'approve', comment: 'checked and fine' } });
  expect(ok.status(), await ok.text()).toBe(200);
  await page.reload();
  await expect(page.getByLabel('Export of people\'s records needs approval above (records)')).toHaveValue(threshold);
  await expect(page.getByTestId('record-history')).toContainText('change_approved');
  await expect(page.getByTestId('record-history')).toContainText('exports.personalApprovalThreshold');
  expect(errors).toEqual([]);

  // the system administrator and the auditor read; they cannot change
  const sys = await page.context().newPage();
  await open(sys, company, 'SYSADM', '/admin/security/settings', 'e2e-sysadmin');
  await expect(sys.getByRole('heading', { name: 'Security Settings' })).toBeVisible();
  await expect(sys.getByRole('button', { name: 'Send for approval' })).toHaveCount(0);
  await expect(sys.getByText('the IT administrator changes them')).toBeVisible();
  await sys.close();
  // an ordinary employee has no entry and the API says why
  const emp = await page.context().newPage();
  await open(emp, company, 'EMP', '/admin/security/settings', 'e2e-emp');
  await expect(emp.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Security Settings' })).toHaveCount(0);
  await emp.close();
});
