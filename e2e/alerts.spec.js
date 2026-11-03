import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.09: take a standard rule from the library, see what it would do (dry-run), run it, work the alert in the Alert Centre (acknowledge, resolve), build a rule
// with the builder, and the approval note of a rule that sends something outside.
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
const ymd = (offset) => new Date(Date.now() + 5.5 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

test('AC-01 FR-02 FR-04 FR-05 FR-06 a standard rule from the library: dry-run, run, then the alert is acknowledged and resolved in the Alert Centre; the run log shows it', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const c = await company(request, `ALR${info.project.name === 'mobile' ? 'M' : 'D'}`);
  await api(request, c, 'PM', 'e2e-pm', 'post', '/tsk/tasks', { title: 'Late concrete test', dueDate: ymd(-3) });
  await api(request, c, 'PM', 'e2e-pm', 'post', '/tsk/tasks', { title: 'Future inspection', dueDate: ymd(20) });
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', '/admin/alert-rules');
  const errors = watch(pm);
  await expect(pm.getByRole('heading', { name: 'Alert Rules', level: 1 })).toBeVisible();
  await expect(pm.getByText('No rule yet')).toBeVisible();
  // the library holds the standard rules; those whose module is not live say so
  await expect(pm.getByTestId('lib-task.overdue')).toBeVisible();
  await expect(pm.getByTestId('lib-stock.below_reorder')).toContainText('waits for stores');
  await pm.getByRole('button', { name: 'Take task.overdue' }).click();
  await pm.getByLabel('Why does the company take task.overdue?').fill('Late tasks must be seen');
  await pm.getByRole('button', { name: 'Take this rule' }).click();
  await expect(pm.getByTestId('ar-notice')).toContainText('task.overdue is now one of your rules');
  const row = pm.getByTestId('rule-task.overdue');
  await expect(row).toContainText('On');
  await noOverflow(pm);
  // what it would do now
  await pm.getByRole('button', { name: 'Dry-run task.overdue' }).click();
  await expect(pm.getByTestId('dry-summary')).toContainText('1 match', { timeout: 15_000 });
  await expect(pm.getByTestId('dry-run')).toContainText('Late concrete test');
  await expect(pm.getByTestId('dry-run')).not.toContainText('Future inspection');
  // run it
  await pm.getByRole('button', { name: 'Run task.overdue now' }).click();
  await expect(pm.getByTestId('ar-notice')).toContainText('1 matched, 1 new alert(s), 0 held back');
  await expect(pm.getByTestId('run-log')).toContainText('task.overdue');
  // the same rule again: held back by the window (BR-01)
  await pm.getByRole('button', { name: 'Run task.overdue now' }).click();
  await expect(pm.getByTestId('ar-notice')).toContainText('0 new alert(s), 1 held back', { timeout: 15_000 });
  // the Alert Centre
  await pm.goto('/alerts');
  await expect(pm.getByRole('heading', { name: 'Alert Centre', level: 1 })).toBeVisible();
  await expect(pm.getByTestId('tile-mine')).toHaveText('1', { timeout: 15_000 });
  const first = pm.locator('[data-testid^="alert-"]').first();
  await expect(first).toContainText('Late concrete test');
  await expect(first).toContainText('Warning');
  await pm.getByRole('button', { name: /^Acknowledge alert/ }).click();
  await expect(pm.getByTestId('ac-notice')).toHaveText('Acknowledged.');
  await expect(first).toContainText('Acknowledged');
  await noOverflow(pm);
  await pm.getByRole('button', { name: /^Resolve alert/ }).click();
  await pm.getByLabel('What was done about it?').fill('Test is booked for tomorrow');
  await pm.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(pm.getByTestId('ac-notice')).toHaveText('Resolved.');
  await expect(pm.getByText('No alert here')).toBeVisible({ timeout: 15_000 });
  await pm.getByRole('search').getByLabel('Status').selectOption('RESOLVED');
  await expect(pm.locator('[data-testid^="alert-"]').first()).toContainText('Test is booked for tomorrow');
  expect(errors).toEqual([]);
});

test('FR-01 FR-05 the Rule Builder: a rule is built, tried on today\'s data and saved; one that sends messages outside says it goes for approval', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const c = await company(request, `ARB${info.project.name === 'mobile' ? 'M' : 'D'}`);
  await api(request, c, 'PM', 'e2e-pm', 'post', '/tsk/tasks', { title: 'Overdue handover', dueDate: ymd(-5), priority: 'HIGH' });
  await api(request, c, 'PM', 'e2e-pm', 'post', '/tsk/tasks', { title: 'Fine one', dueDate: ymd(9) });
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', '/admin/alert-rules/editor');
  const errors = watch(pm);
  await expect(pm.getByRole('heading', { name: 'Rule Builder', level: 1 })).toBeVisible();
  const form = pm.getByTestId('rule-form');
  await form.getByLabel('Code (for example task.overdue)').fill('task.very_late');
  await form.getByLabel('Name', { exact: true }).fill('Task very late');
  await form.getByLabel('Module that owns it').fill('tasks');
  await form.getByLabel('Look at').selectOption('tsk.task');
  await form.getByRole('button', { name: 'Add a condition' }).click();
  const cond = pm.getByTestId('cond-0');
  await cond.getByLabel('Field').selectOption('daysLate');
  await cond.getByRole('combobox', { name: 'Is', exact: true }).selectOption('gte');
  await cond.getByLabel('Value').fill('3');
  await form.getByLabel('Message (may use {{fields}} of what it looks at)').fill('{{taskNo}} {{title}} is {{daysLate}} days late');
  await form.getByLabel('Severity').selectOption('CRITICAL');
  await form.getByLabel('Reason for saving it').fill('Very late tasks go to the top');
  // try it before saving: nothing is written
  await pm.getByRole('button', { name: "Try it on today's data" }).click();
  await expect(pm.getByTestId('prev-matched')).toHaveText('1', { timeout: 15_000 });
  await expect(pm.getByTestId('rb-preview')).toContainText('Overdue handover');
  await expect(pm.getByTestId('rb-preview')).not.toContainText('Fine one');
  await noOverflow(pm);
  await pm.getByRole('button', { name: 'Save the rule' }).click();
  await expect(pm).toHaveURL(/\/admin\/alert-rules$/, { timeout: 15_000 });
  await expect(pm.getByTestId('rule-task.very_late')).toContainText('Critical');
  // a rule that sends by e-mail goes for approval
  await pm.goto('/admin/alert-rules/editor');
  const f2 = pm.getByTestId('rule-form');
  await f2.getByLabel('Code (for example task.overdue)').fill('task.mail');
  await f2.getByLabel('Name', { exact: true }).fill('Task by e-mail');
  await f2.getByLabel('Module that owns it').fill('tasks');
  await f2.getByLabel('Look at').selectOption('tsk.task');
  await f2.getByLabel('Message (may use {{fields}} of what it looks at)').fill('{{taskNo}} is late');
  await pm.getByTestId('action-0').getByLabel('Also by e-mail').check();
  await expect(pm.getByTestId('outside-note')).toBeVisible();
  await f2.getByLabel('Reason for saving it').fill('The director wants an e-mail');
  await pm.getByRole('button', { name: 'Send for approval' }).click();
  await expect(pm.getByTestId('rb-notice')).toContainText('sent for approval');
  await noOverflow(pm);
  expect(errors).toEqual([]);
});

test('AC-03 the pages refuse a person without the permission and name it; everybody has their own Alert Centre', async ({ browser, request }, info) => {
  const c = await company(request, `ARP${info.project.name === 'mobile' ? 'M' : 'D'}`);
  for (const path of ['/admin/alert-rules', '/admin/alert-rules/editor']) {
    const emp = await as(browser, info, c, 'EMP', 'e2e-emp', path);
    await expect(emp.getByText('alr.rule.view').first()).toBeVisible();
    await noOverflow(emp);
  }
  const emp = await as(browser, info, c, 'EMP', 'e2e-emp', '/alerts');
  await expect(emp.getByRole('heading', { name: 'Alert Centre', level: 1 })).toBeVisible();
  await expect(emp.getByText('No alert here')).toBeVisible({ timeout: 15_000 });
  await expect(emp.getByRole('tab', { name: 'Project alerts' })).toHaveCount(0);
  await noOverflow(emp);
});
