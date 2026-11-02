import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.01: the workflow engine's pages (section 7) and the sample document through every path (AC-01, AC-03).
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const as = async (browser, info, company, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true });
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
const newDoc = (request, c, user, amount = '250000.00', title = 'Shuttering plates') => api(request, c, 'PD', user, 'post', '/eng/sample-docs', { title, amount });

test('AC-01 AC-03 the sample document: submit, two approvers decide in the browser, it is locked, and an amendment starts a linked approval', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'the whole path is walked once at desktop width; the phone decides a task below');
  test.setTimeout(150_000);
  const c = await company(request, 'WFD');
  const pd = await as(browser, info, c, 'PD', 'e2e-pd', '/engine/sample-docs');
  const errors = watch(pd);
  await expect(pd.getByRole('heading', { name: 'Sample Documents', level: 1 })).toBeVisible();
  await expect(pd.getByText('No sample document')).toBeVisible();
  await pd.getByRole('button', { name: 'New sample document' }).first().click();
  await pd.getByRole('textbox', { name: 'Title' }).fill('Shuttering plates for the terrace slab');
  await pd.getByLabel('Amount (₹)').fill('250000.00');
  await pd.getByRole('button', { name: 'Save as draft' }).click();
  const detail = pd.getByTestId('sd-detail');
  await expect(detail).toContainText('Shuttering plates for the terrace slab');
  await expect(detail.getByTestId('sd-amount')).toContainText('2,50,000.00');
  await pd.getByRole('button', { name: 'Submit for approval' }).click();
  // the approval opens: two steps (the third needs a large amount), waiting for the project manager
  await expect(pd.getByRole('heading', { name: 'Workflow Instance', level: 1 })).toBeVisible();
  await expect(pd.getByTestId('wf-diagram')).toBeVisible();
  await expect(pd.getByTestId('wf-step-MANAGER')).toContainText('Waiting');
  await expect(pd.getByTestId('wf-step-FINANCE')).toContainText('Not reached');
  await expect(pd.getByText('You raised this document, so someone else must decide on it.')).toBeVisible();
  const instanceUrl = pd.url();
  // the project manager approves
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', instanceUrl.replace(/^https?:\/\/[^/]+/, ''));
  await expect(pm.getByTestId('wf-step-MANAGER')).toContainText('Waiting');
  await pm.getByRole('form', { name: /Decide/ }).getByLabel(/Comment/).fill('quantities checked on site');
  await pm.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(pm.getByTestId('wi-notice')).toContainText('approved');
  await expect(pm.getByTestId('wf-step-MANAGER')).toContainText('Done');
  // the accounts manager approves: the document is approved
  const acc = await as(browser, info, c, 'ACCMGR', 'e2e-acc', instanceUrl.replace(/^https?:\/\/[^/]+/, ''));
  await acc.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(acc.getByTestId('wi-notice')).toContainText('approved');
  await acc.getByRole('tab', { name: 'Timeline' }).click();
  await expect(acc.getByTestId('wi-timeline')).toContainText('Completed');
  await expect(acc.getByTestId('wi-timeline')).toContainText('quantities checked on site');
  // the document is locked; amendment makes a linked new document
  await pd.goto('/engine/sample-docs');
  await pd.getByRole('link', { name: /WSD-/ }).first().click();
  await expect(pd.getByTestId('sd-detail')).toContainText('locked');
  await expect(pd.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(pd.getByTestId('sd-approval')).toContainText('approved');
  await pd.getByRole('button', { name: /^Amend/ }).click();
  await expect(pd.getByTestId('sd-detail')).toContainText('Amends document');
  await expect(pd.getByRole('button', { name: 'Submit for approval' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('FR-03 FR-04 return, resubmit and the question: a returned document keeps its history; a question is answered by the originator', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(150_000);
  const c = await company(request, 'WFR');
  const doc = await newDoc(request, c, 'e2e-pd2');
  const wf = (await api(request, c, 'PD', 'e2e-pd2', 'post', `/eng/sample-docs/${doc.id}/submit`, {})).workflow;
  const path = `/workflow/instance?id=${wf.id}`;
  const pm = await as(browser, info, c, 'PM', 'e2e-pm2', path);
  const errors = watch(pm);
  // a question first
  await pm.getByRole('form', { name: /Decide/ }).getByLabel(/Comment/).fill('Which slab is this for?');
  await pm.getByRole('button', { name: 'Ask a question' }).click();
  await expect(pm.getByTestId('wi-notice')).toContainText('question asked');
  await expect(pm.getByText('Question waiting')).toBeVisible();
  const pd = await as(browser, info, c, 'PD', 'e2e-pd2', path);
  await pd.getByLabel('Answer the question').fill('The terrace slab of block B');
  await pd.getByRole('button', { name: 'Send the answer' }).click();
  await expect(pd.getByTestId('wi-notice')).toContainText('answer sent');
  // the manager returns it with a reason, the originator edits and resubmits
  await pm.reload();
  await pm.getByRole('form', { name: /Decide/ }).getByLabel(/Comment/).fill('Attach the quotation please');
  await pm.getByRole('button', { name: 'Return', exact: true }).click();
  await expect(pm.getByTestId('wi-notice')).toContainText('returned');
  await pd.reload();
  await expect(pd.getByTestId('workflow-instance')).toContainText('Returned');
  await pd.getByRole('button', { name: 'Resubmit' }).click();
  await pd.getByTestId('confirm-dialog').getByRole('button', { name: 'Resubmit' }).click();
  await expect(pd.getByTestId('wi-notice')).toContainText('back in approval');
  await pd.getByRole('tab', { name: 'Timeline' }).click();
  const t = pd.getByTestId('wi-timeline');
  await expect(t).toContainText('Question asked');
  await expect(t).toContainText('Question answered');
  await expect(t).toContainText('Returned to the originator');
  await expect(t).toContainText('Resubmitted');
  await expect(t).toContainText('Attach the quotation please');
  expect(errors).toEqual([]);
});

test('FR-01 FR-08 AC-04 a new version of a definition: edit the steps, see the diagram, request activation; only a maker may; the chain runs', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width; the phone reads the list below');
  test.setTimeout(180_000);
  const c = await company(request, 'WFE');
  await newDoc(request, c, 'e2e-pd3'); // the document type has a definition once it is used; this one is made when a document is submitted
  const doc = (await api(request, c, 'PD', 'e2e-pd3', 'get', '/eng/sample-docs?limit=1')).rows[0];
  await api(request, c, 'PD', 'e2e-pd3', 'post', `/eng/sample-docs/${doc.id}/submit`, {});
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys', '/admin/workflows');
  const errors = watch(sys);
  await expect(sys.getByRole('heading', { name: 'Workflow Definitions', level: 1 })).toBeVisible();
  await expect(sys.getByRole('region', { name: 'Definitions', exact: true })).toContainText('Sample document');
  await sys.getByTestId('wd-new').selectOption('ENG_SAMPLE_DOC');
  await expect(sys.getByRole('heading', { name: 'Workflow Definition Editor', level: 1 })).toBeVisible();
  await expect(sys.getByTestId('wf-diagram')).toBeVisible();
  const steps = sys.locator('[data-testid^="wf-edit-step-"]');
  await expect(steps).toHaveCount(3);
  // remove the CFO step and add a one-person step after the manager
  await steps.nth(2).getByRole('button', { name: /Remove step/ }).click();
  await expect(steps).toHaveCount(2);
  await sys.getByRole('button', { name: 'Add a step' }).click();
  await steps.nth(2).getByLabel('Name').fill('Store check');
  await steps.nth(2).getByLabel('Code').fill('STORE');
  await steps.nth(2).getByLabel('Role', { exact: true }).selectOption('SK');
  await expect(sys.getByTestId('wf-diagram')).toContainText('Store check');
  await expect(sys.getByTestId('wf-step-STORE')).toContainText('SK');
  await sys.getByRole('button', { name: 'Save draft' }).click();
  await expect(sys.getByTestId('we-notice')).toContainText('Saved');
  // a rule of the server shows next to the field
  await steps.nth(2).getByLabel('Code').fill('STEP1');
  await steps.nth(1).getByLabel('Code').fill('STEP1');
  await sys.getByRole('button', { name: 'Save draft' }).click();
  await expect(sys.getByRole('alert').first()).toContainText('Please correct');
  await expect(sys.getByText('used twice').first()).toBeVisible();
  await steps.nth(1).getByLabel('Code').fill('FINANCE');
  await steps.nth(2).getByLabel('Code').fill('STORE');
  // request activation: the chain starts; the maker cannot decide it
  await sys.getByRole('button', { name: 'Save and request activation' }).click();
  await sys.getByTestId('confirm-dialog').getByRole('button', { name: 'Request activation' }).click();
  await expect(sys.getByRole('heading', { name: 'Workflow Instance', level: 1 })).toBeVisible();
  await expect(sys.getByTestId('wf-step-ADMIN')).toContainText('Waiting');
  await expect(sys.getByText('You raised this document, so someone else must decide on it.')).toBeVisible();
  const instance = sys.url().replace(/^https?:\/\/[^/]+/, '');
  // the three approvers, in the browser
  for (const [roles, user, step] of [['SYSADM', 'e2e-sys-2', 'ADMIN'], ['PROCMGR', 'e2e-proc', 'OWNER'], ['ITADM', 'e2e-it', 'TECH']]) {
    const p = await as(browser, info, c, roles, user, instance);
    await expect(p.getByTestId(`wf-step-${step}`)).toContainText('Waiting');
    await p.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(p.getByTestId('wi-notice')).toContainText('approved');
  }
  await sys.goto('/admin/workflows');
  await sys.getByLabel('Status').selectOption('ACTIVE');
  await expect(sys.getByRole('region', { name: 'Definitions', exact: true }).locator('tbody tr')).toHaveCount(1);
  // an active version is read-only
  await sys.getByRole('link', { name: /View Sample document version 2/ }).click();
  await expect(sys.getByText('An active or retired version is never changed')).toBeVisible();
  await expect(sys.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('BR-02 FR-08 nobody to approve: the task waits in the administrators\' queue, shows on the monitor, and an administrator assigns it', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(150_000);
  const c = await company(request, 'WFQ');
  const doc = await newDoc(request, c, 'e2e-pd4');
  // a step for "the reporting manager": nobody manages this person
  const def = await api(request, c, 'SYSADM', 'e2e-sys4', 'post', '/workflow/definitions', { docType: 'ENG_SAMPLE_DOC', name: 'Manager only', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'MGR', name: 'Reporting manager', type: 'approval', mode: 'single', approvers: [{ kind: 'manager' }], slaHours: 24, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] });
  const req = await api(request, c, 'SYSADM', 'e2e-sys4', 'post', `/workflow/definitions/${def.id}/activate`, {});
  let wf = req.instance;
  for (const [roles, user] of [['SYSADM', 'e2e-sys5'], ['PROCMGR', 'e2e-proc4'], ['ITADM', 'e2e-it4']]) wf = await api(request, c, roles, user, 'post', `/workflow/tasks/${wf.tasks.find((t) => t.status === 'OPEN').id}/act`, { action: 'approve' });
  const submitted = (await api(request, c, 'PD', 'e2e-pd4', 'post', `/eng/sample-docs/${doc.id}/submit`, {})).workflow;
  expect(submitted.needsAdmin).toBe(true);
  const mon = await as(browser, info, c, 'AUD', 'e2e-aud', '/admin/workflows/monitor');
  const errors = watch(mon);
  await expect(mon.getByRole('heading', { name: 'Workflow Monitor', level: 1 })).toBeVisible();
  await expect(mon.getByTestId('wm-stuck')).toHaveText('1');
  await expect(mon.getByTestId('wm-running')).toHaveText('1');
  await expect(mon.getByTestId(`wm-attention-${submitted.id}`)).toContainText('Waiting for a workflow administrator');
  await expect(mon.locator('svg.ch-svg')).toBeVisible();
  const download = mon.waitForEvent('download');
  await mon.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('workflow-monitor.csv');
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys6', `/workflow/instance?id=${submitted.id}`);
  await expect(sys.getByText('No eligible approver was found for this step')).toBeVisible();
  await sys.getByLabel('Assign to (user name)').fill('e2e-boss');
  await sys.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(sys.getByTestId('wi-notice')).toContainText('assigned');
  const boss = await as(browser, info, c, 'PM', 'e2e-boss', `/workflow/instance?id=${submitted.id}`);
  await expect(boss.getByTestId('wf-my-tasks')).toHaveCount(0);
  await expect(boss.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('FR-05 AC-03 on a phone: an approver sees the tasks waiting, decides one, and nothing scrolls sideways', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'desktop', 'the phone-width pass');
  test.setTimeout(120_000);
  const c = await company(request, 'WFM');
  const doc = await newDoc(request, c, 'e2e-pd5');
  const wf = (await api(request, c, 'PD', 'e2e-pd5', 'post', `/eng/sample-docs/${doc.id}/submit`, {})).workflow;
  const pm = await as(browser, info, c, 'PM', 'e2e-pm5', '/workflow/instance');
  const errors = watch(pm);
  await expect(pm.getByRole('heading', { name: 'Workflow Instance', level: 1 })).toBeVisible();
  await expect(pm.getByTestId('wf-my-tasks')).toContainText('WSD-');
  await noOverflow(pm);
  await pm.getByTestId('wf-my-tasks').getByRole('link').first().click();
  await expect(pm.getByTestId('wf-diagram')).toBeVisible();
  await noOverflow(pm);
  await pm.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(pm.getByTestId('wi-notice')).toContainText('approved');
  await noOverflow(pm);
  for (const path of ['/admin/workflows', '/admin/workflows/monitor', '/engine/sample-docs']) {
    const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys7', path);
    await expect(sys.locator('main h1')).toBeVisible();
    await noOverflow(sys);
  }
  expect(wf.id).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('AC-04 who sees what: an employee without a part in an approval cannot open it, and the pages say so', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  const c = await company(request, 'WFP');
  const doc = await newDoc(request, c, 'e2e-pd6');
  const wf = (await api(request, c, 'PD', 'e2e-pd6', 'post', `/eng/sample-docs/${doc.id}/submit`, {})).workflow;
  const sk = await as(browser, info, c, 'SK', 'e2e-sk', `/workflow/instance?id=${wf.id}`);
  await expect(sk.getByText('This approval was not found')).toBeVisible();
  await sk.goto('/admin/workflows/monitor');
  await expect(sk.getByText(/not allowed|permission/i).first()).toBeVisible();
});
