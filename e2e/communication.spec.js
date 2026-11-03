import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.07: Channel Settings (a change goes for approval and the settings in force stay until it is decided), a sample message through the first
// connector, a text message blocked because it has no DLT template, the Communication Log with its route and reason, and the Consent Register.
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
const api = async (request, c, roles, user, method, path, data) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).data;
};
const connector = async (request, c, code, type, config = {}) => {
  const made = await api(request, c, 'ITADM', 'e2e-it', 'post', '/core/connectors', { code, type, name: code, provider: 'sandbox', environment: 'development', config, secrets: {}, enabled: true, reason: 'the e2e test' });
  await api(request, c, 'SYSADM', 'e2e-sys', 'post', `/core/change-requests/${made.request.id}/act`, { action: 'approve', comment: 'ok' });
};

test('AC-01 AC-05 Channel Settings: a change is sent for approval and the settings in force stay; the log shows a sample and a blocked text message with the reason; the consent register records a choice', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const c = await company(request, `CMM${info.project.name === 'mobile' ? 'M' : 'D'}`);
  await connector(request, c, `mail.${c}`, 'email', { fromAddress: 'noreply@example.com' });
  await connector(request, c, `sms.a${c}`, 'sms', { simulate: 'down' });
  await connector(request, c, `sms.b${c}`, 'sms');
  const it = await as(browser, info, c, 'ITADM', 'e2e-it', '/admin/communication-channels');
  const errors = watch(it);
  await expect(it.getByRole('heading', { name: 'Channel Settings', level: 1 })).toBeVisible();
  const email = it.getByTestId('cs-EMAIL');
  await email.getByLabel('First connector').selectOption(`mail.${c}`);
  const sms = it.getByTestId('cs-SMS');
  await sms.getByLabel('First connector').selectOption(`sms.a${c}`);
  await sms.getByLabel('If it fails, then').selectOption(`sms.b${c}`);
  await sms.getByLabel('Sender ID (header)').fill('ERPSMS');
  await it.getByRole('button', { name: 'Add a DLT template' }).click();
  const row = it.getByTestId('cs-dlt-0');
  await row.getByLabel('Notification').selectOption('ntf.test');
  await row.getByLabel('DLT template ID').fill('1107161234567890123');
  await row.getByLabel(/Registered text/).fill('Test notification {#var#}');
  await it.getByLabel('Reason for the change').fill('Set up the channels');
  await it.getByRole('button', { name: 'Send for approval' }).click();
  await expect(it.getByTestId('cs-notice')).toContainText('Sent for approval');
  await expect(it.getByTestId('cs-pending')).toBeVisible();
  await noOverflow(it);
  // nothing is in force until the system administrator decides
  const before = await api(request, c, 'ITADM', 'e2e-it', 'get', '/comm/channels');
  expect(before.channels.find((x) => x.channel === 'SMS').active).toBeNull();
  const tasks = await api(request, c, 'SYSADM', 'e2e-sys', 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((t) => JSON.stringify(t).includes('COMM_CONFIG'));
  await api(request, c, 'SYSADM', 'e2e-sys', 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'ok' });
  await it.reload();
  await expect(it.getByTestId('cs-pending')).toHaveCount(0);
  await expect(it.getByTestId('cs-SMS').getByLabel('First connector')).toHaveValue(`sms.a${c}`);
  // a sample by e-mail leaves; a sample by text message goes to the second connector after the first fails
  const sample = it.getByTestId('cs-sample');
  await sample.getByLabel('Channel').selectOption('EMAIL');
  await sample.getByLabel('Send a sample to').fill('meera@example.com');
  await sample.getByRole('button', { name: 'Send sample' }).click();
  await expect(it.getByTestId('cs-sample-result')).toContainText('SENT', { timeout: 20_000 });
  await sample.getByLabel('Channel').selectOption('SMS');
  await sample.getByLabel('Send a sample to').fill('+919812345678');
  await sample.getByRole('button', { name: 'Send sample' }).click();
  await expect(it.getByTestId('cs-sample-result')).toContainText(`via sms.b${c}`, { timeout: 30_000 });
  // WhatsApp has no approved template: refused with the reason, never sent
  await api(request, c, 'ITADM', 'e2e-it', 'post', '/comm/consents', { address: '+919812345678', channel: 'WHATSAPP', status: 'OPT_IN' });
  // the log
  await it.goto('/admin/communication-log');
  await expect(it.getByRole('heading', { name: 'Communication Log', level: 1 })).toBeVisible();
  await expect(it.getByTestId('cl-totals')).toContainText('message(s)');
  await it.getByRole('search').getByLabel('Status').selectOption('SENT');
  const first = it.locator('[data-testid^="cl-row-"]').first();
  await expect(first).toContainText('Sent');
  await first.getByRole('button', { name: /^Open message/ }).click();
  await expect(it.getByTestId('cl-detail')).toBeVisible();
  await noOverflow(it);
  await it.getByRole('search').getByLabel('Status').selectOption('');
  await it.getByRole('search').getByLabel('Channel').selectOption('SMS');
  await it.locator('[data-testid^="cl-row-"]').first().getByRole('button', { name: /^Open message/ }).click();
  await expect(it.getByTestId('cl-route')).toContainText(`sms.a${c}`);
  await expect(it.getByTestId('cl-route')).toContainText(`sms.b${c}`);
  // the consent register
  await it.goto('/admin/communication-consents');
  await expect(it.getByRole('heading', { name: 'Consent Register', level: 1 })).toBeVisible();
  const form = it.getByTestId('cr-form');
  await form.getByLabel('Number or address').fill('+919800000077');
  await form.getByLabel('Choice').selectOption('OPT_OUT');
  await form.getByLabel('Name', { exact: true }).fill('Meera Traders');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(it.getByTestId('cr-notice')).toHaveText('Saved.');
  await expect(it.getByText('Meera Traders').first()).toBeVisible();
  await it.getByRole('button', { name: 'History' }).first().click();
  await expect(it.getByTestId('cr-history')).toContainText('opted out');
  await noOverflow(it);
  expect(errors).toEqual([]);
});

test('AC-06 pages refuse a person without the permission, with the permission named', async ({ browser, request }, info) => {
  const c = await company(request, `CMN${info.project.name === 'mobile' ? 'M' : 'D'}`);
  for (const [path, permission] of [['/admin/communication-log', 'comm.log.view'], ['/admin/communication-channels', 'comm.channel.view'], ['/admin/communication-consents', 'comm.consent.view']]) {
    const emp = await as(browser, info, c, 'EMP', 'e2e-emp', path);
    await expect(emp.getByText(permission).first()).toBeVisible();
    await noOverflow(emp);
  }
});
