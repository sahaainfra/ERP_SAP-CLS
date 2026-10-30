import { test, expect } from '@playwright/test';

// Both viewport projects share one database, so each test uses its own company per project.
const company = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);

async function open(page, roles, path, companyId, user = 'e2e-health') {
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

const headers = (roles, companyId, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': companyId, 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}` });

test('Operations Health: figures, objectives, alert rules, baseline; a forced error is followed end to end by its correlation ID', async ({ page }, info) => {
  const companyId = company(info, '101', '102');
  const errors = await open(page, 'ITADM', '/admin/operations/health', companyId);
  await expect(page.getByRole('heading', { name: 'Operations Health' })).toBeVisible();
  await expect(page).toHaveTitle(/Operations Health/);
  await expect(page.getByTestId('tile-rpm')).toBeVisible();
  await expect(page.getByTestId('tile-dlq')).toHaveText('0');
  await expect(page.getByTestId('slo-login')).toBeVisible();
  await expect(page.getByTestId('slo-bill_calculation')).toContainText('Calculate a bill');
  await expect(page.getByTestId('no-open-alerts')).toBeVisible();

  await page.locator('summary', { hasText: 'Alert rules' }).click();
  await expect(page.getByTestId('rule-error_spike')).toBeVisible();
  await page.locator('summary', { hasText: 'Performance baseline' }).click();
  await expect(page.getByTestId('baseline-events_list')).toBeVisible();

  await page.getByRole('button', { name: 'Force a test error' }).click();
  const id = page.getByTestId('forced-id').locator('code');
  await expect(id).toHaveText(/.{8,}/);
  const cid = (await id.textContent()).trim();
  await page.getByRole('textbox', { name: 'Correlation ID' }).fill(cid);
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  const found = page.getByTestId('follow-result');
  await expect(found).toContainText('log lines');
  await expect(found).toContainText('unhandled error');
  await expect(found).toContainText('core.ops.diagnostic');
  await expect(page.getByTestId('waterfall')).toBeVisible();
  await noOverflow(page);
  expect(errors.filter((e) => !/500|Failed to load resource/.test(e))).toEqual([]);
});

test('Operations Health: an objective change is a request, approved by the System Administrator', async ({ page, request }, info) => {
  const companyId = company(info, '103', '104');
  const latency = company(info, '250', '260'); // objectives are shared by every company, so each project asks for its own value
  await open(page, 'ITADM', '/admin/operations/health', companyId, 'e2e-itadm');
  await page.getByTestId('slo-login').getByRole('button', { name: 'Request change' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Target latency (ms)').fill(latency);
  await dialog.getByLabel(/Reason/).fill('tighten the login objective');
  await dialog.getByRole('button', { name: 'Request change' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Change requested' })).toBeVisible();
  const list = await request.get('/api/v1/core/change-requests?filter[type]=ops_config_change', { headers: headers('SYSADM', companyId, 'e2e-sys') });
  const pending = (await list.json()).data.find((r) => r.type === 'ops_config_change');
  expect(pending).toBeTruthy();
  const act = await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: headers('SYSADM', companyId, 'e2e-sys'), data: { action: 'approve', comment: 'ok' } });
  expect(act.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId('slo-login')).toContainText(`target ${latency} ms`);
});

test('Operations Health: SYSADM views but cannot act; a project manager has no access; the browser reports its errors', async ({ page, context, request }, info) => {
  const companyId = company(info, '105', '106');
  await open(page, 'SYSADM', '/admin/operations/health', companyId, 'e2e-sys');
  await expect(page.getByRole('heading', { name: 'Operations Health' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Force a test error' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check alerts now' })).toBeDisabled();

  const pm = await context.newPage();
  await open(pm, 'PM', '/admin/operations/health', companyId, 'e2e-pm');
  await expect(pm.getByRole('heading', { name: 'You do not have access to operations health' })).toBeVisible();
  await pm.close();

  // A real script error in the browser reaches the server as a redacted report.
  await page.evaluate(() => { setTimeout(() => { throw new Error('e2e-browser-fault PAN ABCDE1234F'); }, 0); });
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(async () => {
    const r = await request.get('/api/v1/core/ops/client-events?type=js_error', { headers: headers('ITADM', companyId, 'e2e-itadm') });
    return JSON.stringify((await r.json()).data);
  }, { timeout: 8000 }).toContain('e2e-browser-fault');
  const all = await (await request.get('/api/v1/core/ops/client-events', { headers: headers('ITADM', companyId, 'e2e-itadm') })).text();
  expect(all).not.toContain('ABCDE1234F');
});
