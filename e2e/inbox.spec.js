import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.03: My Approvals, the task page with its evidence, approving in bulk and from a secure link, the phone view,
// My Submissions & Watch List, and the approval settings.
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
const raise = async (request, c, user, title, amount, context) => {
  const d = await api(request, c, 'PD', user, 'post', '/eng/sample-docs', { title, amount });
  if (context) return api(request, c, 'PD', user, 'post', '/workflow/submit', { docType: 'ENG_SAMPLE_DOC', docId: d.id, context: { amount: Number(amount), ...context } });
  return (await api(request, c, 'PD', user, 'post', `/eng/sample-docs/${d.id}/submit`, {})).workflow;
};

test('AC-01 FR-01 FR-04 the inbox: counts, filters, a saved variant, approving several together, the one with a risk flag left for its own decision', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(150_000);
  const c = await company(request, 'IBA');
  await raise(request, c, 'e2e-pd', 'Cement bags', '12000.00');
  await raise(request, c, 'e2e-pd', 'Steel binding wire', '18000.00');
  await raise(request, c, 'e2e-pd', 'Crane hire', '90000.00');
  await raise(request, c, 'e2e-pd', 'Emergency pump', '7000.00', { emergency: true });
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', '/approvals');
  const errors = watch(pm);
  await expect(pm.getByRole('heading', { name: 'My Approvals', level: 1 })).toBeVisible();
  await expect(pm.getByTestId('ib-pending')).toHaveText('4');
  await expect(pm.getByRole('region', { name: 'Approvals waiting' }).locator('tbody tr')).toHaveCount(4);
  await expect(pm.getByText('Emergency purchase')).toBeVisible();
  // a filter, saved as a variant, then chosen again
  await pm.getByLabel('Words').fill('crane');
  await expect(pm.getByRole('region', { name: 'Approvals waiting' }).locator('tbody tr')).toHaveCount(1);
  await pm.getByLabel('Name for this filter').fill('Cranes');
  await pm.getByRole('button', { name: 'Save variant' }).click();
  await pm.getByRole('button', { name: 'Clear filters' }).click();
  await expect(pm.getByRole('region', { name: 'Approvals waiting' }).locator('tbody tr')).toHaveCount(4);
  await pm.getByRole('combobox', { name: /^Saved variant/ }).selectOption({ label: 'Cranes' });
  await expect(pm.getByRole('region', { name: 'Approvals waiting' }).locator('tbody tr')).toHaveCount(1);
  await pm.getByRole('combobox', { name: /^Saved variant/ }).selectOption({ label: 'None' });
  // bulk: only the two small ones qualify
  await pm.getByLabel('Only those that can be approved together').check();
  await expect(pm.getByRole('region', { name: 'Approvals waiting' }).locator('tbody tr')).toHaveCount(2);
  await pm.getByRole('button', { name: 'Select every one that can be approved together' }).click();
  await pm.getByRole('button', { name: /^Approve 2 selected/ }).click();
  await pm.getByTestId('confirm-dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(pm.getByTestId('ib-result')).toContainText('2 approved');
  await pm.getByLabel('Only those that can be approved together').uncheck();
  await expect(pm.getByTestId('ib-pending')).toHaveText('2');
  // the remaining two cannot be selected for bulk: trying names the reason
  const flagged = pm.getByRole('row', { name: /Emergency pump/ });
  await flagged.getByRole('checkbox').check();
  await pm.getByRole('button', { name: /^Approve 1 selected/ }).click();
  await pm.getByTestId('confirm-dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(pm.getByTestId('ib-result')).toContainText('1 not approved');
  await expect(pm.getByTestId('ib-result')).toContainText('risk flags');
  await expect(pm.getByTestId('ib-pending')).toHaveText('2');
  expect(errors).toEqual([]);
});

test('AC-01 FR-02 FR-03 the task page: the document, the evidence, the history and the decision; then a secure link works once', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(150_000);
  const c = await company(request, 'IBT');
  await raise(request, c, 'e2e-pd2', 'Formwork', '150000.00');
  const wf = await raise(request, c, 'e2e-pd2', 'Formwork', '8000.00');
  const taskId = wf.tasks[0].id;
  const pm = await as(browser, info, c, 'PM', 'e2e-pm2', `/approvals/task?id=${taskId}`);
  const errors = watch(pm);
  await expect(pm.getByRole('heading', { name: 'Approval Task', level: 1 })).toBeVisible();
  await expect(pm.getByTestId('evidence')).toBeVisible();
  await expect(pm.getByTestId('ev-request')).toContainText('Average of the last five');
  await expect(pm.getByTestId('ev-time')).toBeVisible();
  await expect(pm.getByTestId('ev-empty')).toHaveCount(0);
  await pm.getByRole('tab', { name: 'Document' }).click();
  await expect(pm.getByText('Formwork').first()).toBeVisible();
  await pm.getByRole('tab', { name: 'History' }).click();
  await expect(pm.getByRole('list', { name: 'History' })).toContainText('Submitted');
  // a secure link for the phone, opened with nobody signed in
  await pm.getByRole('button', { name: 'Make a secure link for my phone' }).click();
  const text = await pm.getByTestId('at-link').innerText();
  const url = /(https?:\/\/\S+\/approve-link\?t=\S+)/.exec(text)[1];
  const stranger = await browser.newContext({ viewport: info.project.use.viewport });
  const page = await stranger.newPage();
  await page.goto(url);
  await expect(page.getByTestId('approve-link')).toContainText('Formwork');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('link-done')).toContainText('Approved');
  await page.goto(url);
  await expect(page.getByTestId('link-gone')).toBeVisible();
  // the decision shows on the task, and the next approver is asked
  await pm.reload();
  await expect(pm.getByText('already', { exact: false }).first()).toBeVisible();
  const fin = await api(request, c, 'ACCMGR', 'e2e-acc2', 'get', '/workflow/inbox');
  expect(fin.rows.some((r) => r.title === 'Formwork' && r.step === 'FINANCE')).toBe(true);
  expect(errors).toEqual([]);
});

test('FR-05 AC-01 on a phone: cards in order of urgency, one tap to approve, a reason to reject, nothing scrolls sideways', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'desktop', 'the phone-width pass');
  test.setTimeout(120_000);
  const c = await company(request, 'IBM');
  await raise(request, c, 'e2e-pdm', 'Scaffolding pipes', '15000.00');
  await raise(request, c, 'e2e-pdm', 'Diesel for the DG set', '22000.00');
  const pm = await as(browser, info, c, 'PM', 'e2e-pmm', '/field/approvals');
  const errors = watch(pm);
  await expect(pm.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
  await expect(pm.getByRole('list', { name: 'Waiting for you' }).locator('li')).toHaveCount(2);
  await noOverflow(pm);
  await pm.getByRole('list', { name: 'Waiting for you' }).locator('li').first().getByRole('button').click();
  await expect(pm.getByTestId('mob-detail')).toBeVisible();
  await noOverflow(pm);
  const box = await pm.getByRole('button', { name: 'Approve', exact: true }).boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await pm.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(pm.getByTestId('mob-notice')).toContainText('approved');
  await pm.getByRole('list', { name: 'Waiting for you' }).locator('li').first().getByRole('button').click();
  await pm.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(pm.getByRole('button', { name: 'Reject now' })).toBeDisabled();
  await pm.getByLabel(/Why do you reject/).fill('Not needed this month');
  await pm.getByRole('button', { name: 'Reject now' }).click();
  await expect(pm.getByTestId('mob-notice')).toContainText('rejected');
  await expect(pm.getByText('Nothing is waiting for you')).toBeVisible();
  for (const path of ['/approvals', '/approvals/submissions']) { await pm.goto(path); await expect(pm.locator('main h1')).toBeVisible(); await noOverflow(pm); }
  expect(errors).toEqual([]);
});

test('FR-07 My Submissions & Watch List: what I raised with who it waits for; what I follow; the approval settings of the document types', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(120_000);
  const c = await company(request, 'IBS');
  const wf = await raise(request, c, 'e2e-pds', 'Tiles', '9000.00');
  const pd = await as(browser, info, c, 'PD', 'e2e-pds', '/approvals/submissions');
  const errors = watch(pd);
  await expect(pd.getByRole('heading', { name: 'My Submissions & Watch List', level: 1 })).toBeVisible();
  await expect(pd.getByTestId(`sb-row-${wf.id}`)).toContainText('PM');
  await expect(pd.getByTestId(`sb-row-${wf.id}`)).toContainText('In approval');
  await pd.getByRole('tab', { name: 'I follow' }).click();
  await expect(pd.getByTestId(`sb-row-${wf.id}`)).toBeVisible();
  await pd.getByRole('button', { name: /Stop following/ }).click();
  await expect(pd.getByText('You follow no document')).toBeVisible();
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-syss', '/admin/escalation');
  await expect(sys.getByTestId('approval-policies')).toBeVisible();
  await expect(sys.getByTestId('pol-ENG_SAMPLE_DOC')).toBeVisible();
  const sk = await as(browser, info, c, 'SK', 'e2e-sks', '/approvals');
  await expect(sk.getByText('Nothing is waiting for you')).toBeVisible();
  expect(errors).toEqual([]);
});
