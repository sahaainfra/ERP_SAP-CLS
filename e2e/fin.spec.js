import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100).
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const api = async (request, c, roles, user, method, path, data) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).data;
};
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/number-series', { docType: 'SAMPLE_DOC', name: 'Sample documents', prefix: 'SMP', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' });
  return id;
}
// the people of the company: written straight into the throw-away database of the run (the dev-header mode has no sign-in to make them)
function people(c, list) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [name, roles, display] of list) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, name, display, JSON.stringify(roles), `${name}@example.com`);
  db.close();
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

// Part 06.05: the chart of accounts and cost codes. The accounts manager proposes a new account on the Chart of Accounts page and the CFO approves it; the account page checks a posting (T-01) and changes a
// dimension rule; the project controls manager proposes a cost code, checked by the accounts manager and approved by the CFO; the mapping is complete for every item category (AC-01) and a Tally ledger
// list gives its mapping report; on a computer and a phone, with no console error and no sideways scroll.
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked against the chart' });
};
async function setup(request, code) {
  const c = await company(request, code);
  const t = code.toLowerCase();
  const u = { acc: `${t}-acc`, pcm: `${t}-pcm`, cfo: `${t}-cfo`, pm: `${t}-pm` };
  people(c, [[u.acc, ['ACCMGR'], 'Anita Accounts'], [u.pcm, ['PCMGR'], 'Prakash Controls'], [u.cfo, ['CFO'], 'Chitra CFO'], [u.pm, ['PM'], 'Pooja Project']]);
  return { c, u };
}

test('FR-01 FR-02 the chart of accounts: tree and filters, a new account proposed and approved by the CFO; a project manager only reads', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'FCAM' : 'FCAD');
  const { page } = await open(browser, info, g.c, 'ACCMGR', g.u.acc, '/finance/chart-of-accounts');
  const errors = watch(page);
  await expect(page.getByTestId('chart-of-accounts')).toBeVisible();
  await expect(page.getByTestId('coa-group').first()).toContainText('1 Assets');
  await expect(page.getByTestId('coa-account').filter({ hasText: '220001 Trade payables - suppliers' })).toContainText('Control: Accounts payable');
  await page.getByTestId('coa-control').selectOption('yes');
  await expect(page.getByTestId('coa-account').filter({ hasText: '510001' })).toHaveCount(0);
  await expect(page.getByTestId('coa-account').filter({ hasText: '170001 GST input - CGST' })).toBeVisible();
  await page.getByTestId('coa-control').selectOption('');
  await noOverflow(page);
  await page.getByTestId('coa-new-account').click();
  await page.getByTestId('coa-f-code').fill('560090');
  await page.getByTestId('coa-f-name').fill('Site security services');
  await page.getByTestId('coa-f-group').selectOption({ label: '5600 Other expenses (construction and overheads) (Expenses)' });
  await page.getByTestId('coa-f-type').selectOption('EXPENSE');
  await page.getByTestId('coa-f-reason').fill('security guards at the sites');
  await page.getByTestId('coa-f-save').click();
  await expect(page.getByTestId('coa-note')).toContainText('sent to the CFO for approval');
  await expect(page.getByTestId('coa-pending')).toContainText('1 change');
  await page.getByTestId('coa-tab-changes').click();
  await expect(page.getByTestId('coa-change').first()).toContainText('New account 560090 Site security services');
  const change = (await api(request, g.c, 'ACCMGR', g.u.acc, 'get', '/fin/changes?status=PENDING')).rows[0];
  await act(request, g.c, 'CFO', g.u.cfo, change.instanceId);
  await page.getByTestId('coa-tab-tree').click();
  await page.reload();
  await expect(page.getByTestId('coa-account').filter({ hasText: '560090 Site security services' })).toBeVisible();
  await page.getByTestId('coa-tab-schedule').click();
  await expect(page.getByTestId('coa-s3-status')).toContainText('Every group and account lands on a line of Schedule III');
  await noOverflow(page);
  expect(errors).toEqual([]);
  const pm = await open(browser, info, g.c, 'PM', g.u.pm, '/finance/chart-of-accounts');
  await expect(pm.page.getByTestId('coa-account').first()).toBeVisible();
  await expect(pm.page.getByTestId('coa-new-account')).toHaveCount(0);
});

test('T-01 FR-04 the account page: a manual posting without a project is rejected; a dimension rule change goes to the CFO; BR-01 a control account', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'FACM' : 'FACD');
  const chart = await api(request, g.c, 'ACCMGR', g.u.acc, 'get', '/fin/accounts');
  const mat = chart.accounts.find((a) => a.code === '510001');
  const ap = chart.accounts.find((a) => a.code === '220001');
  const { page } = await open(browser, info, g.c, 'ACCMGR', g.u.acc, `/finance/accounts/account?id=${mat.id}`);
  const errors = watch(page);
  await expect(page.getByTestId('account-page')).toContainText('510001 Materials consumed');
  await page.getByTestId('acc-probe-check').click();
  await expect(page.getByTestId('acc-probe-result')).toContainText('needs a project');
  await page.getByTestId('acc-tab-dimensions').click();
  await expect(page.getByTestId('acc-dim-PROJECT')).toHaveValue('MANDATORY');
  await page.getByTestId('acc-dim-COST_CENTRE').selectOption('OPTIONAL');
  await page.getByTestId('acc-dims-reason').fill('cost centres for the shared site stores');
  await page.getByTestId('acc-dims-save').click();
  await expect(page.getByTestId('acc-note')).toContainText('sent to the CFO');
  await expect(page.getByTestId('acc-pending')).toBeVisible();
  await noOverflow(page);
  await page.goto(`/finance/accounts/account?id=${ap.id}`);
  await expect(page.getByTestId('account-page')).toContainText('Control: Accounts payable');
  await expect(page.getByTestId('acc-manual')).toHaveText('Not allowed');
  await page.getByTestId('acc-probe-check').click();
  await expect(page.getByTestId('acc-probe-result')).toContainText('control account');
  await page.getByTestId('acc-probe-source').selectOption('ENGINE');
  await page.getByTestId('acc-probe-check').click();
  await expect(page.getByTestId('acc-probe-result')).toContainText('would be accepted');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-03 FR-05 FR-06 cost codes by project controls (accounts manager, then CFO), the item category mapping is complete, a Tally ledger list gives its mapping report', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'FCCM' : 'FCCD');
  const { page } = await open(browser, info, g.c, 'PCMGR', g.u.pcm, '/finance/cost-codes');
  const errors = watch(page);
  await expect(page.getByTestId('cc-head').first()).toContainText('1 Material');
  await page.getByTestId('cc-head').filter({ hasText: '1.1 Cement' }).click();
  await expect(page.getByTestId('cc-detail')).toContainText('Posted to');
  await expect(page.getByTestId('cc-code').first()).toContainText('MAT-CEM');
  await page.getByTestId('cc-new-code').click();
  await page.getByTestId('cc-f-code').fill('MAT-CEM-PPC');
  await page.getByTestId('cc-f-name').fill('Cement PPC');
  await page.getByTestId('cc-f-uom').fill('MT');
  await page.getByTestId('cc-f-reason').fill('PPC cement tracked apart from OPC');
  await page.getByTestId('cc-f-save').click();
  await expect(page.getByTestId('cc-note')).toContainText('the accounts manager checks it, then the CFO');
  const change = (await api(request, g.c, 'ACCMGR', g.u.acc, 'get', '/fin/changes?status=PENDING')).rows[0];
  await act(request, g.c, 'ACCMGR', g.u.acc, change.instanceId);
  await act(request, g.c, 'CFO', g.u.cfo, change.instanceId);
  await page.reload();
  await page.getByTestId('cc-head').filter({ hasText: '1.1 Cement' }).click();
  await expect(page.getByTestId('cc-code').filter({ hasText: 'MAT-CEM-PPC' })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
  const acc = await open(browser, info, g.c, 'ACCMGR', g.u.acc, '/finance/category-mapping');
  const e2 = watch(acc.page);
  await expect(acc.page.getByTestId('cm-status')).toContainText('Complete');
  await expect(acc.page.getByTestId('cm-row').filter({ hasText: 'CEMENT Cement' })).toContainText('MAT-CEM');
  await noOverflow(acc.page);
  await acc.page.goto('/finance/chart-of-accounts?tab=import');
  await acc.page.getByTestId('coa-import-text').fill('Name,Under\nUltratech Cement Ltd,Sundry Creditors\nHDFC Bank CA 0042,Bank Accounts\nSuspense,Suspense A/c');
  await acc.page.getByTestId('coa-import-preview').click();
  await expect(acc.page.getByTestId('coa-import-summary')).toContainText('2 of 3 ledgers map to this chart');
  await expect(acc.page.getByTestId('coa-import-row').filter({ hasText: 'Ultratech' })).toContainText('2200 Trade payables');
  await noOverflow(acc.page);
  expect(e2).toEqual([]);
});
