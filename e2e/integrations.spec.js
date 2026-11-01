import { test, expect } from '@playwright/test';

// Both viewport projects share one database, so each test uses its own company and connector codes per project.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const KEY = 'e2e-secret-key-777-ABCDEF';

async function open(page, roles, path, companyId, user = 'e2e-hub') {
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

async function approvePending(request, companyId, code) {
  const list = await request.get('/api/v1/core/change-requests?filter[type]=connector_change', { headers: headers('SYSADM', companyId, 'e2e-sys') });
  const pending = (await list.json()).data.filter((r) => r.status === 'SUBMITTED' && r.payload.code === code).at(-1);
  expect(pending, `a pending request for ${code}`).toBeTruthy();
  const res = await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: headers('SYSADM', companyId, 'e2e-sys'), data: { action: 'approve', comment: 'ok' } });
  expect(res.status()).toBe(200);
}

test('Connectors: create by request, approve, test, send a sample through the abstraction and read the redacted log', async ({ page, request }, info) => {
  const companyId = pick(info, '111', '112');
  const code = pick(info, 'mail.desk', 'mail.mob');
  const errors = await open(page, 'ITADM', '/admin/integrations', companyId);
  await expect(page.getByRole('heading', { name: 'Connectors', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Integrations/);
  await expect(page.getByRole('heading', { name: 'No connectors' })).toBeVisible();

  await page.getByRole('button', { name: 'New connector' }).first().click();
  await expect(page.getByRole('heading', { name: 'New connector' })).toBeVisible();
  await page.locator('input[name=code]').fill(code);
  await page.locator('input[name=name]').fill('Office mail');
  await page.locator('input[name=cfg_fromAddress]').fill('noreply@example.com');
  await page.locator('input[name=secret_api_key]').fill(KEY);
  await page.locator('input[name=enabled]').check();
  await page.locator('textarea[name=reason]').fill('office email for notices');
  await page.getByRole('button', { name: 'Request connector' }).click();

  const row = page.getByTestId(`connector-${code}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Waiting for approval');
  await expect(row.getByRole('button', { name: `Test connection ${code}` })).toBeDisabled();

  await approvePending(request, companyId, code);
  await page.reload();
  await expect(row).toContainText('On');
  await row.getByRole('button', { name: `Test connection ${code}` }).click();
  await expect(page.getByRole('status').filter({ hasText: 'connection works' })).toBeVisible();
  await expect(row).toContainText('Healthy');

  await row.getByRole('link', { name: code }).click();
  await expect(page.getByRole('heading', { name: code })).toBeVisible();
  await expect(page.getByTestId('state-status')).toHaveText('On');
  await expect(page.getByTestId('secret-api_key')).toContainText('Set (hidden)');
  await page.getByRole('button', { name: 'Send sample message' }).click();
  await expect(page.getByTestId('config-notice')).toContainText('Sample message sent');
  expect(await page.content()).not.toContain(KEY);

  await page.goto('/admin/integrations/log');
  await expect(page.getByRole('heading', { name: 'Integration Log' })).toBeVisible();
  const sendRow = page.getByTestId(/^log-/).filter({ hasText: 'send' }).first();
  await expect(sendRow).toContainText('Success');
  await sendRow.getByRole('button', { name: /Show details/ }).click();
  const detail = page.getByTestId('log-detail');
  await expect(detail).toContainText('Test message from the integration hub');
  await expect(detail).not.toContainText('This message was sent through the provider abstraction');
  await expect(detail).toContainText('Correlation ID');
  expect(await page.content()).not.toContain(KEY);
  await page.keyboard.press('Escape');
  await page.getByLabel('Status').first().selectOption('failure');
  await expect(page.getByRole('heading', { name: 'No calls logged' })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Connector configuration: a change and a key rotation are requests; the connector can be switched off at once', async ({ page, request }, info) => {
  const companyId = pick(info, '113', '114');
  const code = pick(info, 'mail.cfgd', 'mail.cfgm');
  await request.post('/api/v1/core/connectors', { headers: headers('ITADM', companyId, 'e2e-itadm'), data: { code, type: 'email', name: 'Config mail', provider: 'sandbox', config: { fromAddress: 'noreply@example.com' }, secrets: { api_key: KEY }, enabled: true, reason: 'set up for the test' } }).then((r) => expect(r.status()).toBe(201));
  await approvePending(request, companyId, code);

  await open(page, 'ITADM', '/admin/integrations', companyId, 'e2e-itadm');
  await page.getByTestId(`connector-${code}`).getByRole('link', { name: code }).click();
  await page.locator('input[name=rateLimitPerMinute]').fill('120');
  await page.locator('input[name=secret_api_key]').fill('rotated-key-ZZZ-123456');
  await page.locator('form[aria-label="Change connector"] textarea[name=reason]').fill('raise the limit and rotate the key');
  await page.getByRole('button', { name: 'Request change' }).click();
  await expect(page.getByTestId('config-notice')).toContainText('Change requested');
  await expect(page.getByText('waiting for approval')).toBeVisible();
  await expect(page.locator('input[name=rateLimitPerMinute]')).toHaveValue('120');

  await approvePending(request, companyId, code);
  await page.reload();
  await expect(page.locator('input[name=rateLimitPerMinute]')).toHaveValue('120');
  await expect(page.getByTestId('secret-api_key')).toContainText('Set (hidden)');
  expect(await page.content()).not.toContain('rotated-key-ZZZ');

  await page.getByRole('button', { name: 'Switch off now' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Reason/).fill('provider outage, pausing mail');
  await dialog.getByRole('button', { name: 'Switch off', exact: true }).click();
  await expect(page.getByTestId('state-status')).toHaveText('Off');
  await expect(page.getByRole('button', { name: 'Send sample message' })).toBeDisabled();
});

test('Integrations: SYSADM can view but not act; a project manager has no access; CFO sees the bank request in Approvals', async ({ page, context, request }, info) => {
  const companyId = pick(info, '115', '116');
  const code = pick(info, 'bank.desk', 'bank.mob');
  const create = await request.post('/api/v1/core/connectors', { headers: headers('ITADM', companyId, 'e2e-itadm'), data: { code, type: 'bank', name: 'Bank file feed', provider: 'http_json', config: { baseUrl: 'https://api.bank.example.com' }, secrets: { api_key: KEY }, reason: 'bank payment files' } });
  expect(create.status()).toBe(201);
  expect((await create.json()).data.request.chain).toEqual(['SYSADM', 'CFO']);

  await open(page, 'SYSADM', '/admin/integrations', companyId, 'e2e-sys');
  await expect(page.getByTestId(`connector-${code}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New connector' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: `Test connection ${code}` })).toBeDisabled();

  const pm = await context.newPage();
  await open(pm, 'PM', '/admin/integrations', companyId, 'e2e-pm');
  await expect(pm.getByTestId('no-permission')).toBeVisible();
  await pm.close();

  const cfo = await context.newPage();
  await open(cfo, 'CFO', '/admin/approvals', companyId, 'e2e-cfo');
  await expect(cfo.getByText(`Create connector ${code}`)).toBeVisible();
  await cfo.close();
});
