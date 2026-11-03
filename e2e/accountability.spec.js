import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.05: the RACI matrix, the gap check, My Accountability and the Accountability Report.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422)/.test(m.text()) && errors.push(m.text()));
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
const approve = async (request, c, roles, user, instanceId) => {
  const tasks = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows;
  const t = tasks.find((x) => x.instance.id === instanceId);
  expect(t, `a task for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${t.id}/act`, { action: 'approve', comment: 'ok' });
};


const project = async (request, c, code, status) => {
  const p = await api(request, c, 'PM', 'e2e-pm2', 'post', '/iam/org/projects', { code, name: `${code} Road`, type: 'ROAD' });
  if (status === 'ACTIVE') {
    await api(request, c, 'PM', 'e2e-pm2', 'post', `/iam/org/projects/${p.id}/activation-requests`, { reason: 'Mobilise now please' });
    for (const [roles, user] of [['PD', 'e2e-pd'], ['PCMGR', 'e2e-pc']]) {
      const pending = (await api(request, c, roles, user, 'get', '/core/change-requests?filter[type]=org_activation')).filter((r) => r.status === 'SUBMITTED' && r.payload.code === code).at(-1);
      expect(pending, 'a pending activation').toBeTruthy();
      await api(request, c, roles, user, 'post', `/core/change-requests/${pending.id}/act`, { action: 'approve', comment: 'checked and fine' });
    }
  }
  return p;
};

test('AC-01 FR-01 FR-02 FR-04 FR-06 the standard processes are applied to a project, the gap check empties, an actor\'s work appears in My Accountability, and the report shows it', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(180_000);
  const c = await company(request, 'RAA');
  const p = await project(request, c, 'RA1', 'DRAFT');
  const hr = await as(browser, info, c, 'HRMGR', 'e2e-hr', '/admin/raci');
  const errors = watch(hr);
  await expect(hr.getByRole('heading', { name: 'RACI Matrix', level: 1 })).toBeVisible();
  await expect(hr.getByText('Choose a scope')).toBeVisible();
  await hr.getByLabel('Which').selectOption(String(p.id));
  await expect(hr.getByTestId('raci-scope')).toContainText('RA1');
  await expect(hr.getByTestId('gap-summary')).toContainText('15');
  await hr.getByRole('button', { name: 'Apply the standard processes' }).click();
  for (const [role, who] of [['PM', 'e2e-pm'], ['PD', 'e2e-pd'], ['STOREMGR', 'e2e-store'], ['CFO', 'e2e-cfo'], ['COMMGR', 'e2e-com'], ['HRMGR', 'e2e-hr']]) await hr.getByRole('textbox', { name: `Who is ${role}` }).fill(who);
  await hr.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(hr.getByTestId('raci-notice')).toContainText('Applied: 15');
  await expect(hr.getByTestId('gap-summary')).toContainText('0');
  await expect(hr.getByTestId('raci-row-PO_ISSUE')).toContainText('e2e-pm');
  // a change in the grid: add a person as Responsible for one process, and change who is accountable for another
  await hr.getByLabel('User name').fill('e2e-eng');
  await hr.getByRole('button', { name: 'Add column' }).click();
  await hr.getByLabel('Purchase order: e2e-eng').selectOption('R');
  await expect(hr.getByTestId('raci-changed')).toContainText('1');
  await hr.getByLabel('Reason', { exact: true }).fill('An engineer helps with the orders');
  await hr.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(hr.getByTestId('raci-notice')).toContainText('Saved: 1');
  // two accountable people are refused by the server and said so
  await hr.getByLabel('Purchase requisition: e2e-eng').selectOption('A');
  await hr.getByLabel('Reason', { exact: true }).fill('Two accountable people at once');
  await hr.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(hr.getByTestId('raci-error')).toContainText('exactly one');
  await hr.getByRole('button', { name: 'Discard the changes' }).click();
  expect(errors).toEqual([]);

  // the actor's work: a sample document goes through approval
  const d = await api(request, c, 'PD', 'e2e-pd', 'post', '/eng/sample-docs', { title: 'Formwork', amount: '15000.00', projectId: p.id });
  const sub = await api(request, c, 'PD', 'e2e-pd', 'post', `/eng/sample-docs/${d.id}/submit`, {});
  await approve(request, c, 'PM', 'e2e-pm', sub.workflow.id);
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', '/accountability');
  const e2 = watch(pm);
  await expect(pm.getByRole('heading', { name: 'My Accountability', level: 1 })).toBeVisible();
  await expect(pm.getByTestId('ma-accountable')).not.toHaveText('0');
  await expect(pm.getByRole('region', { name: 'Responsibilities' })).toContainText('Sample document request');
  await expect(pm.getByRole('region', { name: 'My recent actions' })).toContainText('Approved');
  await expect(pm.getByTestId('ma-ontime')).toContainText('100');
  await expect(pm.getByTestId('ma-note')).toContainText('never a penalty');
  await noOverflow(pm);
  expect(e2).toEqual([]);

  const aud = await as(browser, info, c, 'AUD', 'e2e-aud', '/reports/accountability');
  const e3 = watch(aud);
  await expect(aud.getByRole('heading', { name: 'Accountability Report', level: 1 })).toBeVisible();
  await expect(aud.getByTestId('ar-row-e2e-pm')).toContainText('100');
  await aud.getByRole('button', { name: 'Show the actions of e2e-pm' }).click();
  await expect(aud.getByTestId('ar-drill')).toContainText('Approved');
  const download = aud.waitForEvent('download');
  await aud.getByRole('button', { name: 'Export XLSX' }).click();
  expect((await download).suggestedFilename()).toBe('accountability.xlsx');
  await aud.getByRole('combobox', { name: /^By/ }).selectOption('project');
  await expect(aud.getByTestId('ar-table')).toContainText('RA1');
  await noOverflow(aud);
  expect(e3).toEqual([]);
});

test('FR-01 AC-03 a live project\'s change is sent for approval; a person without the permission is told so; the pages fit a phone', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const c = await company(request, `RAB${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const p = await project(request, c, 'RB1', 'ACTIVE');
  const pmPage = await as(browser, info, c, 'PM', 'e2e-pm', '/admin/raci');
  const errors = watch(pmPage);
  await pmPage.getByLabel('Which').selectOption(String(p.id));
  await expect(pmPage.getByTestId('raci-scope')).toContainText('RB1');
  await pmPage.getByLabel('User name').fill('e2e-pm');
  await pmPage.getByRole('button', { name: 'Add column' }).click();
  await pmPage.getByLabel('Daily progress report: e2e-pm').or(pmPage.getByLabel('DPR submission: e2e-pm')).selectOption('A');
  await pmPage.getByLabel('Reason', { exact: true }).fill('The project manager answers for the report');
  await pmPage.getByRole('button', { name: /Send for approval|Save/ }).first().click();
  await expect(pmPage.getByTestId('raci-notice')).toContainText(/approval|Saved/);
  await noOverflow(pmPage);
  expect(errors).toEqual([]);
  const sk = await as(browser, info, c, 'SK', 'e2e-sk', '/admin/raci');
  await expect(sk.getByText(/permission/i).first()).toBeVisible();
  await sk.goto('/accountability');
  await expect(sk.getByRole('heading', { name: 'My Accountability', level: 1 })).toBeVisible();
  await expect(sk.getByText('Nothing is assigned to you yet')).toBeVisible();
  await noOverflow(sk);
  await sk.goto('/reports/accountability');
  await expect(sk.getByText(/permission/i).first()).toBeVisible();
});
