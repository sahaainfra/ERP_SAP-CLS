import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.06: the notification centre and the bell, real-time delivery to an open screen, preferences, the templates with their preview and their
// approval, and the delivery log.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
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

test('AC-01 FR-04 FR-07 a decision on a document reaches the originator\'s open screen at once: the bell counts it, the drawer shows it, the centre opens the document; read, archive and read-all work', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const c = await company(request, `NTA${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const pd = await as(browser, info, c, 'PD', 'e2e-pd', '/notifications');
  const errors = watch(pd);
  await expect(pd.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(pd.getByText('No notifications yet')).toBeVisible();
  // the director sends a document for approval and the project manager rejects it while the director's screen is open
  const d = await api(request, c, 'PD', 'e2e-pd', 'post', '/eng/sample-docs', { title: 'Formwork plates', amount: '12000.00' });
  await api(request, c, 'PD', 'e2e-pd', 'post', `/eng/sample-docs/${d.id}/submit`, {});
  const tasks = await api(request, c, 'PM', 'e2e-pm', 'get', '/workflow/tasks?mine=assigned');
  await api(request, c, 'PM', 'e2e-pm', 'post', `/workflow/tasks/${tasks.rows[0].id}/act`, { action: 'reject', comment: 'The rate is too high.' });
  // real time: no reload, no waiting for a poll of a minute
  await expect(pd.getByTestId('bell-count')).toHaveText('1', { timeout: 20_000 });
  await expect(pd.getByTestId('nc-list')).toContainText('Rejected: Sample document', { timeout: 20_000 });
  await expect(pd.getByTestId('nc-list')).toContainText('The rate is too high.');
  await pd.getByTestId('bell').click();
  await expect(pd.getByTestId('bell-drawer')).toContainText('Rejected');
  await noOverflow(pd);
  await pd.keyboard.press('Escape');
  await expect(pd.getByTestId('bell-drawer')).toBeHidden();
  // the drawer opens the document's approval and reads the notification
  await pd.getByTestId('bell').click();
  await pd.getByTestId('bell-list').getByRole('button').first().click();
  await expect(pd).toHaveURL(/\/workflow\/instance\?id=/);
  await expect(pd.getByTestId('bell-count')).toHaveCount(0);
  // the centre: unread filter, mark unread, archive, read-all
  await pd.goto('/notifications');
  await pd.getByRole('button', { name: /^Mark unread/ }).first().click();
  await pd.getByRole('tab', { name: /Unread/ }).click();
  await expect(pd.getByTestId('nc-list')).toContainText('Rejected');
  await pd.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(pd.getByText('You have read everything')).toBeVisible();
  await pd.getByRole('tab', { name: 'All' }).click();
  await pd.getByRole('button', { name: /^Archive/ }).first().click();
  await expect(pd.getByText('No notifications yet')).toBeVisible();
  await pd.getByRole('tab', { name: 'Archived' }).click();
  await expect(pd.getByTestId('nc-list')).toContainText('Rejected');
  await noOverflow(pd);
  expect(errors).toEqual([]);
});

test('FR-05 AC-02 preferences are kept and respected; the templates are read in both languages, previewed, and a change waits for the IT administrator; the delivery log shows what left', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(180_000);
  const c = await company(request, 'NTB');
  const emp = await as(browser, info, c, 'PM', 'e2e-pref', '/notifications/preferences');
  const errors = watch(emp);
  await expect(emp.getByRole('heading', { name: 'Notification Preferences', level: 1 })).toBeVisible();
  await expect(emp.getByLabel('Security: E-mail')).toBeDisabled();
  await expect(emp.getByLabel('Security: E-mail')).toBeChecked();
  await emp.getByLabel('Approvals: E-mail').uncheck();
  await emp.getByLabel(/Hold back messages/).check();
  await emp.locator('select').filter({ hasText: 'An hourly digest' }).selectOption('HOURLY');
  await emp.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(emp.getByTestId('np-notice')).toContainText('saved');
  await emp.reload();
  await expect(emp.getByLabel('Approvals: E-mail')).not.toBeChecked();
  await expect(emp.getByLabel(/Hold back messages/)).toBeChecked();
  await emp.getByRole('button', { name: 'Send me a test' }).click();
  await expect(emp.getByTestId('np-notice')).toContainText('test');
  await emp.goto('/notifications');
  await expect(emp.getByTestId('nc-list')).toContainText('Test notification', { timeout: 20_000 });

  // templates: the system administrator previews in Hindi and sends a change; the IT administrator approves it
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys', '/admin/notification-templates');
  const e2 = watch(sys);
  await expect(sys.getByRole('heading', { name: 'Notification Templates', level: 1 })).toBeVisible();
  await sys.getByTestId('tpl-row-workflow.task.assigned').getByRole('button', { name: /Open|View/ }).click();
  await expect(sys.getByTestId('tpl-preview')).toContainText('anil.pd sent Sample document'.replace('Sample document', 'Purchase order'));
  await sys.getByLabel('Language').selectOption('hi');
  await expect(sys.getByTestId('tpl-preview')).toContainText('आपके निर्णय के लिए भेजा है');
  await sys.getByLabel('Language').selectOption('en');
  await sys.getByRole('textbox', { name: /^Text/ }).fill('{{actor}} is waiting for you on {{docRef}} ({{step}}).');
  await expect(sys.getByTestId('tpl-preview')).toContainText('anil.pd is waiting for you on PO-0001 (Project manager).');
  await sys.getByRole('textbox', { name: /^Text/ }).fill('Open {{nobody}}');
  await expect(sys.getByTestId('tpl-preview')).toContainText('Not a fact of this template: nobody');
  await sys.getByRole('textbox', { name: /^Text/ }).fill('{{actor}} is waiting for you on {{docRef}} ({{step}}).');
  await sys.getByRole('textbox', { name: /^Reason for the change/ }).fill('Say it more plainly');
  await sys.getByRole('button', { name: 'Send for approval' }).click();
  await expect(sys.getByTestId('tpl-notice')).toContainText('Sent for approval');
  const it = await api(request, c, 'ITADM', 'e2e-it', 'get', '/workflow/tasks?mine=assigned');
  expect(it.rows.length).toBe(1);
  await api(request, c, 'ITADM', 'e2e-it', 'post', `/workflow/tasks/${it.rows[0].id}/act`, { action: 'approve', comment: 'ok' });
  const after = await api(request, c, 'SYSADM', 'e2e-sys', 'get', '/ntf/templates/workflow.task.assigned');
  expect(after.entries.find((x) => x.channel === 'IN_APP' && x.lang === 'en').version).toBe(2);
  expect(e2).toEqual([]);

  // the delivery log: the IT administrator sees the test message of the preferences, with the e-mail the person has none for
  const log = await as(browser, info, c, 'ITADM', 'e2e-it', '/admin/notification-deliveries');
  const e3 = watch(log);
  await expect(log.getByRole('heading', { name: 'Delivery Log', level: 1 })).toBeVisible();
  await expect(log.getByRole('region', { name: 'Deliveries' })).toContainText('Test notification');
  await expect(log.getByTestId('dl-totals')).toBeVisible();
  const download = log.waitForEvent('download');
  await log.getByRole('button', { name: 'Export XLSX' }).click();
  expect((await download).suggestedFilename()).toBe('deliveries.xlsx');
  await noOverflow(log);
  expect(e3).toEqual([]);
  expect(errors).toEqual([]);
  // a person without the permission is told so
  const other = await as(browser, info, c, 'PM', 'e2e-other', '/admin/notification-deliveries');
  await expect(other.getByText(/permission/i).first()).toBeVisible();
  await other.goto('/admin/notification-templates');
  await expect(other.getByText(/permission/i).first()).toBeVisible();
});
