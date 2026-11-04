import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.08: a task from form to closing (evidence needed, then done), My Tasks as list, board and calendar, Team Tasks, an instruction that has nobody to
// go to, and the Department Responsibility Matrix with its approval.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHhgCAh6X4CYAAAAASUVORK5CYII=', 'base64');
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

test('AC-01 FR-04 a task from the form to closing: evidence is asked for, the checklist and discussion work, the views show it as list, board and calendar', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const c = await company(request, `TSK${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', '/tasks/new');
  const errors = watch(pm);
  await expect(pm.getByRole('heading', { name: 'New Task / Senior Instruction', level: 1 })).toBeVisible();
  const form = pm.getByTestId('task-form');
  await form.getByLabel('Title').fill('Photograph the rebar at pier 4');
  await form.getByLabel('Due date').fill(ymd(2));
  await form.getByLabel('Checklist (one item on each line)').fill('Clean the bars\nPhotograph each layer');
  await form.getByLabel('Needs evidence (a photo or a document)').check();
  await form.getByLabel('Priority').selectOption('HIGH');
  await form.getByRole('button', { name: 'Make the task' }).click();
  await expect(pm).toHaveURL(/\/tasks\/task\?id=/, { timeout: 15_000 });
  await expect(pm.getByRole('heading', { name: /TSK-\d{5}: Photograph the rebar at pier 4/ })).toBeVisible();
  await pm.getByRole('button', { name: 'Start' }).click();
  await expect(pm.getByTestId('task-notice')).toContainText('Start: done');
  // BR: evidence is needed before it is done
  await pm.getByRole('button', { name: 'Mark done' }).click();
  await expect(pm.getByTestId('task-error')).toContainText('needs evidence');
  await pm.getByRole('tab', { name: 'Evidence' }).click();
  await expect(pm.getByTestId('evidence-missing')).toBeVisible();
  await pm.getByTestId('file-input').setInputFiles([{ name: 'pier4.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(pm.getByTestId('file-pier4.png')).toBeVisible();
  await expect(pm.getByTestId('evidence-ok')).toBeVisible({ timeout: 20_000 });
  // the checklist and the discussion
  await pm.getByRole('tab', { name: /Checklist/ }).click();
  await pm.getByTestId('task-checklist').getByRole('checkbox').first().click();
  await expect(pm.getByRole('tab', { name: /Checklist \(1\/2\)/ })).toBeVisible();
  await pm.getByRole('tab', { name: /Discussion/ }).click();
  await pm.getByLabel('Comment', { exact: true }).fill('Bars cleaned, photos next.');
  await pm.getByRole('button', { name: 'Comment' }).click();
  await expect(pm.getByTestId('task-discussion')).toContainText('Bars cleaned, photos next.');
  await noOverflow(pm);
  // done: with evidence it closes (no verification was asked for)
  await pm.getByRole('button', { name: 'Mark done' }).click();
  await expect(pm.getByRole('heading', { level: 2 }).locator('..').getByText('Closed', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await pm.getByRole('tab', { name: 'History' }).click();
  await expect(pm.getByTestId('task-history')).toContainText('close');
  // more tasks through the API: one late, one due soon, for the views
  await api(request, c, 'PM', 'e2e-pm', 'post', '/tsk/tasks', { title: 'Renew the site insurance', dueDate: ymd(-3), priority: 'URGENT' });
  await api(request, c, 'PM', 'e2e-pm', 'post', '/tsk/tasks', { title: 'Monthly reconciliation', dueDate: ymd(0), recurrence: { freq: 'MONTHLY', interval: 1 } });
  await pm.goto('/tasks');
  await expect(pm.getByRole('heading', { name: 'My Tasks', level: 1 })).toBeVisible();
  await expect(pm.getByTestId('count-open')).toHaveText('2', { timeout: 15_000 });
  await expect(pm.getByTestId('count-overdue')).toHaveText('1');
  await expect(pm.getByTestId('task-row-' + (await api(request, c, 'PM', 'e2e-pm', 'get', '/tsk/tasks?status=open&limit=1&sort=due')).rows[0].id)).toContainText('late');
  await pm.getByRole('button', { name: 'Board' }).click();
  await expect(pm.getByTestId('board-OPEN')).toContainText('Renew the site insurance');
  await expect(pm.getByTestId('board-OPEN')).toContainText('Monthly reconciliation');
  await noOverflow(pm);
  await pm.getByRole('button', { name: 'Calendar' }).click();
  await expect(pm.getByTestId('task-calendar')).toBeVisible();
  await expect(pm.getByTestId('task-calendar')).toContainText('Monthly reconciliation');
  await noOverflow(pm);
  await pm.getByRole('button', { name: 'List' }).click();
  await pm.getByRole('searchbox').or(pm.getByLabel('Words')).first().fill('insurance');
  await expect(pm.locator('[data-testid^="task-row-"]')).toHaveCount(1);
  // the work page of the day lists the open tasks
  expect(errors).toEqual([]);
});

test('FR-06 FR-05 Team Tasks shows the workload and what is late; an instruction with nobody to go to is refused with what to do', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const c = await company(request, `TTM${info.project.name === 'mobile' ? 'M' : 'D'}`);
  await api(request, c, 'PM', 'e2e-pm', 'post', '/tsk/tasks', { title: 'Late concrete test', dueDate: ymd(-4) });
  await api(request, c, 'PM', 'e2e-pm', 'post', '/tsk/tasks', { title: 'Tidy the yard', dueDate: ymd(5) });
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', '/tasks/team');
  const errors = watch(pm);
  await expect(pm.getByRole('heading', { name: 'Team Tasks', level: 1 })).toBeVisible();
  await expect(pm.getByTestId('tile-open')).toHaveText('2', { timeout: 15_000 });
  await expect(pm.getByTestId('tile-overdue')).toHaveText('1');
  await expect(pm.getByTestId('person-e2e-pm')).toContainText('2');
  await expect(pm.getByTestId('overdue-list')).toContainText('Late concrete test');
  await noOverflow(pm);
  // an instruction for a topic nobody covers
  await pm.goto('/tasks/new');
  await pm.getByRole('tab', { name: 'Senior instruction by topic' }).click();
  const form = pm.getByTestId('task-form');
  await form.getByLabel('Title').fill('Brief the sites');
  await form.getByLabel('Topic (for example safety.ppe)').fill('nothing.here');
  await expect(pm.getByTestId('route-failed')).toContainText('No row of the responsibility matrix covers the topic nothing.here', { timeout: 15_000 });
  await form.getByRole('button', { name: 'Send the instruction' }).click();
  await expect(form.getByRole('alert')).toContainText('responsibility matrix', { timeout: 15_000 });
  await noOverflow(pm);
  // a person without the right: the page says so and names the permission
  const emp = await as(browser, info, c, 'EMP', 'e2e-emp', '/tasks/team');
  await expect(emp.getByText('tsk.team.view').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('AC-04 the Department Responsibility Matrix: a change is sent for approval, the matrix in force stays until the system administrator approves, then the topic routes', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const c = await company(request, `TRM${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const dept = await api(request, c, 'HRMGR', 'e2e-hr', 'post', '/iam/org/departments', { code: 'HSE', name: 'Safety', kind: 'DEPARTMENT' });
  const hr = await as(browser, info, c, 'HRMGR', 'e2e-hr', '/admin/task-routing');
  const errors = watch(hr);
  await expect(hr.getByRole('heading', { name: 'Department Responsibility Matrix', level: 1 })).toBeVisible();
  await expect(hr.getByText('No topic is set up yet')).toBeVisible();
  await hr.getByRole('button', { name: 'Add a topic' }).click();
  const row = hr.getByTestId('row-0');
  await row.getByLabel('Topic code').fill('safety.ppe');
  await row.getByLabel('Topic name').fill('Protective equipment');
  await row.getByLabel('Department').selectOption(String(dept.id));
  await row.getByLabel('Responsible role (code)').fill('PM');
  await row.getByLabel('Days to do it').fill('3');
  await row.getByLabel('Needs evidence').check();
  await hr.getByLabel('Reason for the change').fill('Safety asked for it');
  await hr.getByRole('button', { name: 'Send for approval' }).click();
  await expect(hr.getByTestId('rm-notice')).toContainText('Sent for approval');
  await expect(hr.getByTestId('rm-pending')).toBeVisible();
  await expect(hr.getByText('No topic is set up yet')).toBeVisible();
  await noOverflow(hr);
  // the system administrator approves
  const tasks = await api(request, c, 'SYSADM', 'e2e-sys', 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((t) => JSON.stringify(t).includes('TSK_ROUTING'));
  await api(request, c, 'SYSADM', 'e2e-sys', 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'ok' });
  await hr.reload();
  await expect(hr.getByTestId('topic-safety.ppe')).toContainText('Protective equipment');
  await expect(hr.getByTestId('topic-safety.ppe')).toContainText('Safety');
  expect(errors).toEqual([]);
  // a person who may not see it
  const emp = await as(browser, info, c, 'EMP', 'e2e-emp', '/admin/task-routing');
  await expect(emp.getByText('tsk.routing.view').first()).toBeVisible();
});
