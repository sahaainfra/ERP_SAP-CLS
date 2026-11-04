import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.04: the Protocol & Control Engine: a control stops a sample document, the person raises an exception from the dialog, attaches
// evidence, the project manager approves it, the document goes ahead, and the registry, the dashboard, the reason codes and the control points show it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHhgCAh6X4CYAAAAASUVORK5CYII=', 'base64');
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

test('AC-01 FR-02 FR-03 FR-05 FR-07 a control stops a sample document, an exception is raised from the dialog with evidence, the project manager approves it, the document goes ahead; the register and the dashboard show it', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(180_000);
  const c = await company(request, 'PCA');
  const today = new Date().toISOString().slice(0, 10);
  // for this company the observation needed before ENFORCE is zero days; then the control is taken to ENFORCE through its approval chain
  await api(request, c, 'SYSADM', 'e2e-sys', 'post', '/core/parameters', { key: 'eng.pcs.observe_days', value: 0, scopeType: 'company', scopeId: c, effectiveFrom: today, reason: 'e2e set-up' });
  const change = await api(request, c, 'SYSADM', 'e2e-sys', 'put', '/pcs/control-points/CP-ENG-01', { mode: 'ENFORCE', reason: 'Observed long enough for this test company.' });
  expect(change.applied).toBe(false);
  await approve(request, c, 'PROCMGR', 'e2e-proc', change.workflow.id);
  await approve(request, c, 'AUD', 'e2e-aud', change.workflow.id);

  const pd = await as(browser, info, c, 'PD', 'e2e-pd', '/engine/sample-docs');
  const errors = watch(pd);
  await pd.getByRole('button', { name: 'New sample document' }).first().click();
  await pd.getByRole('textbox', { name: 'Title', exact: true }).fill('Scaffolding for the podium');
  await pd.getByLabel('Amount (₹)').fill('750000.00');
  await pd.getByRole('button', { name: 'Save as draft' }).click();
  const detail = pd.getByTestId('sd-detail');
  await expect(detail).toBeVisible();
  await expect(pd.getByTestId('cycle-PLAN')).toContainText('Done');
  await detail.getByRole('button', { name: 'Submit for approval' }).click();
  // the control stops it and the dialog opens by itself
  const dialog = pd.getByTestId('raise-exception');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('rx-why')).toContainText('CP-ENG-01');
  await dialog.getByLabel('Reason').selectOption('URGENT_COMMERCIAL');
  await dialog.getByLabel('Justification').fill('The podium slab is cast on Saturday and the scaffolding must be ordered today.');
  await dialog.getByRole('button', { name: 'Save and add evidence' }).click();
  await expect(dialog.getByTestId('rx-saved')).toContainText('EXC-');
  // evidence is required for this control
  await dialog.getByRole('button', { name: 'Send for approval' }).click();
  await expect(dialog.getByTestId('rx-error')).toContainText('Attach at least one file');
  await dialog.getByTestId('file-input').setInputFiles([{ name: 'site photo.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(dialog.getByTestId('file-site photo.png')).toBeVisible();
  await dialog.getByRole('button', { name: 'Send for approval' }).click();
  await expect(pd.getByTestId('sd-notice')).toContainText('sent for approval');
  await expect(dialog).toBeHidden();
  // the project manager approves the exception (level 1)
  const reg = (await api(request, c, 'PD', 'e2e-pd', 'get', '/pcs/exceptions')).rows[0];
  expect(reg.status).toBe('PENDING');
  await approve(request, c, 'PM', 'e2e-pm', reg.instanceId);
  await detail.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(pd).toHaveURL(/\/workflow\/instance/, { timeout: 15_000 }); // the document went into approval: the control let it through on the exception
  expect(errors).toEqual([]);

  // the register: the exception is used, with its detail, and can be exported
  await pd.goto('/controls/exceptions');
  await expect(pd.getByRole('heading', { name: 'Exceptions Register', level: 1 })).toBeVisible();
  await expect(pd.getByTestId('exceptions').locator('tbody tr')).toHaveCount(1);
  await expect(pd.getByTestId('exceptions').locator('tbody')).toContainText('Used');
  await pd.locator('label', { has: pd.locator('span', { hasText: /^Status$/ }) }).locator('select').selectOption('REJECTED');
  await expect(pd.getByText('No exception matches')).toBeVisible();
  await pd.getByRole('button', { name: 'Clear filters' }).click();
  await pd.getByRole('link', { name: /EXC-/ }).click();
  await expect(pd.getByTestId('ex-detail')).toContainText('Justification');
  await expect(pd.getByTestId('ex-detail')).toContainText('site photo.png');
  const download = pd.waitForEvent('download');
  await pd.getByRole('button', { name: 'Export XLSX' }).click();
  expect((await download).suggestedFilename()).toBe('exceptions.xlsx');

  // the dashboard, for those who watch
  const aud = await as(browser, info, c, 'AUD', 'e2e-aud', '/controls/dashboard');
  const e2 = watch(aud);
  await expect(aud.getByRole('heading', { name: 'Controls Dashboard', level: 1 })).toBeVisible();
  await expect(aud.getByTestId('cd-tiles')).toBeVisible();
  await expect(aud.getByTestId('controls-dashboard').getByRole('region', { name: 'Top failing controls' })).toContainText('CP-ENG-01');
  await expect(aud.getByTestId('cd-rollout')).toContainText('Enforce');
  await noOverflow(aud);
  expect(e2).toEqual([]);
});

test('FR-01 FR-04 FR-06 the registry shows the mode and what a control would have stopped; reason codes are one master; a person without the permission is told so', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const c = await company(request, `PCB${info.project.name === 'mobile' ? 'M' : 'D'}`);
  await api(request, c, 'PD', 'e2e-pd', 'get', '/pcs/reason-codes'); // reachable by every internal role
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys', '/admin/controls');
  const errors = watch(sys);
  await expect(sys.getByRole('heading', { name: 'Control Points', level: 1 })).toBeVisible();
  const row = sys.getByTestId('cp-row-CP-ENG-01');
  await expect(row).toContainText('Observe');
  await expect(row).toContainText('Needs an exception');
  await expect(sys.getByTestId('cp-row-CP-ENG-03')).toContainText('Off');
  await sys.getByLabel('Mode').selectOption('OFF');
  await expect(sys.getByTestId('cp-row-CP-ENG-01')).toHaveCount(0);
  await sys.getByLabel('Mode').selectOption('');
  await row.getByRole('button', { name: /Open/ }).click();
  await expect(sys.getByTestId('cp-stats')).toContainText('Observed');
  await sys.getByTestId('cp-edit').getByLabel('Mode').selectOption('ENFORCE');
  await sys.getByLabel('Reason for the change').fill('We want it enforced now.');
  await sys.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sys.getByRole('alert').filter({ hasText: '14 days' })).toBeVisible(); // BR-01: not enough observation yet
  await noOverflow(sys);
  await sys.getByRole('button', { name: 'Close' }).click();
  // switching a mode that is not ENFORCE takes effect at once
  await sys.getByTestId('cp-row-CP-ENG-03').getByRole('button', { name: /Open/ }).click();
  await expect(sys.getByTestId('cp-edit')).toContainText('CP-ENG-03');
  await sys.getByTestId('cp-edit').getByLabel('Mode').selectOption('OBSERVE');
  await sys.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sys.getByTestId('cp-notice')).toContainText('CP-ENG-03 saved');
  await expect(sys.getByTestId('cp-row-CP-ENG-03')).toContainText('Observe');
  // reason codes
  await sys.goto('/admin/reason-codes');
  await expect(sys.getByRole('heading', { name: 'Reason Codes', level: 1 })).toBeVisible();
  await expect(sys.getByTestId('rc-row-reverse-WRONG_POSTING')).toBeVisible();
  await sys.getByRole('button', { name: 'New reason code' }).click();
  await sys.getByLabel('For the action').selectOption('reverse');
  await sys.getByRole('textbox', { name: /^Code/ }).fill('WRONG_GST');
  await sys.getByLabel('What the person reads').fill('Wrong GST rate applied');
  await sys.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sys.getByTestId('rc-notice')).toContainText('WRONG_GST saved');
  await expect(sys.getByTestId('rc-row-reverse-WRONG_GST')).toBeVisible();
  expect(errors).toEqual([]);
  // no permission: a store keeper sees the states, not the data
  const sk = await as(browser, info, c, 'SK', 'e2e-sk', '/admin/controls');
  await expect(sk.getByText(/permission/i).first()).toBeVisible();
  await sk.goto('/controls/exceptions');
  await expect(sk.getByRole('heading', { name: 'Exceptions Register', level: 1 })).toBeVisible();
  await expect(sk.getByText('No exception yet')).toBeVisible();
  await noOverflow(sk);
});
