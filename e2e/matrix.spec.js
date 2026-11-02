import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.02: the approval matrix, rule editor, authority limits, simulator, delegations and the escalation and SLA settings.
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
const approve = async (request, c, instance, who) => {
  let wf = instance;
  for (const [roles, user] of who) wf = await api(request, c, roles, user, 'post', `/workflow/tasks/${wf.tasks.find((t) => t.status === 'OPEN').id}/act`, { action: 'approve' });
  expect(wf.status).toBe('APPROVED');
};
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test('FR-01 FR-09 BR-01 BR-02 AC-02 a new version of a matrix: edit the rules, check for gaps, ask to activate from tomorrow, approve, and the simulator shows the new chain from that date', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(180_000);
  const c = await company(request, 'MXA');
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys', '/admin/approval-matrix');
  const errors = watch(sys);
  await expect(sys.getByRole('heading', { name: 'Approval Matrix', level: 1 })).toBeVisible();
  await expect(sys.getByRole('region', { name: 'Matrix versions' })).toContainText('Payment release');
  await sys.getByTestId('am-new').selectOption('PAY');
  await expect(sys.getByRole('heading', { name: 'Matrix Rule Editor', level: 1 })).toBeVisible();
  const rules = sys.locator('[data-testid^="me-rule-"]');
  await expect(rules).toHaveCount(3);
  // a gap is found: take the closing rule away
  await rules.nth(2).getByRole('button', { name: /Remove rule/ }).click();
  await sys.getByRole('button', { name: 'Check for gaps' }).click();
  await expect(sys.getByTestId('me-checks')).toContainText('leave gaps');
  await expect(sys.getByTestId('me-checks')).toContainText('would match no rule');
  await sys.getByRole('button', { name: 'Request activation' }).click();
  await sys.getByTestId('confirm-dialog').getByRole('button', { name: 'Request activation' }).click();
  await expect(sys.getByRole('alert').first()).toContainText('gaps');
  await sys.getByTestId('confirm-dialog').getByRole('button', { name: 'Keep as it is' }).click();
  // close the gap with a rule for everything else, the payment to the director too
  await sys.getByRole('button', { name: 'Add a rule' }).click();
  await expect(rules).toHaveCount(3);
  await rules.nth(2).getByLabel('Step 1 role').selectOption('DIR');
  await sys.getByRole('button', { name: 'Check for gaps' }).click();
  await expect(sys.getByTestId('me-checks')).toContainText('No document can fall through');
  await sys.getByRole('button', { name: 'Request activation' }).click();
  await sys.getByTestId('confirm-dialog').getByRole('button', { name: 'Request activation' }).click();
  await expect(sys.getByRole('heading', { name: 'Workflow Instance', level: 1 })).toBeVisible();
  await expect(sys.getByText('You raised this document, so someone else must decide on it.')).toBeVisible();
  const url = sys.url().replace(/^https?:\/\/[^/]+/, '');
  const id = new URL(sys.url()).searchParams.get('id');
  const inst = await api(request, c, 'SYSADM', 'e2e-sys', 'get', `/workflow/instances/${id}`);
  await approve(request, c, inst, [['SYSADM', 'e2e-sys2'], ['CFO', 'e2e-cfo']]);
  expect(url).toContain('/workflow/instance');
  // the version is in force from tomorrow; the simulator tells the old chain for today and the new one for tomorrow
  const sim = await as(browser, info, c, 'AUD', 'e2e-aud', '/admin/approval-simulator');
  await sim.getByLabel('Document type').selectOption('PAY');
  await sim.getByLabel('Value').first().fill('20000000');
  await sim.getByLabel('Date').fill(tomorrow());
  await sim.getByRole('button', { name: 'Show the chain' }).click();
  await expect(sim.getByTestId('as-steps')).toContainText('DIR');
  await expect(sim.getByTestId('as-steps')).not.toContainText('CFO');
  await sim.getByLabel('Date').fill(new Date().toISOString().slice(0, 10));
  await sim.getByRole('button', { name: 'Show the chain' }).click();
  await expect(sim.getByTestId('as-rule')).toContainText('Above');
  await expect(sim.getByTestId('as-steps')).toContainText('CFO');
  await sys.goto('/admin/approval-matrix');
  await sys.getByRole('search', { name: 'Filter the matrix' }).getByLabel('Document type').selectOption('PAY');
  await expect(sys.getByRole('region', { name: 'Matrix versions' }).locator('tbody tr')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('FR-03 the authority limits grid: change a limit, ask, approve, and the grid shows it', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(120_000);
  const c = await company(request, 'MXL');
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sysl', '/admin/authority-limits');
  const errors = watch(sys);
  await expect(sys.getByRole('heading', { name: 'Authority Limits', level: 1 })).toBeVisible();
  const cell = sys.getByLabel('Limit of PM for PO in rupees');
  await expect(cell).toHaveValue('2500000');
  await cell.fill('3000000');
  await sys.getByLabel('Reason').fill('The project managers run larger sites');
  await sys.getByRole('button', { name: 'Ask for approval' }).click();
  await sys.getByTestId('confirm-dialog').getByRole('button', { name: 'Ask for approval' }).click();
  await expect(sys.getByRole('heading', { name: 'Workflow Instance', level: 1 })).toBeVisible();
  const id = new URL(sys.url()).searchParams.get('id');
  await approve(request, c, await api(request, c, 'SYSADM', 'e2e-sysl', 'get', `/workflow/instances/${id}`), [['SYSADM', 'e2e-sysl2'], ['CFO', 'e2e-cfol']]);
  await sys.goto('/admin/authority-limits');
  await expect(sys.getByLabel('Limit of PM for PO in rupees')).toHaveValue('3000000');
  await expect(sys.getByRole('region', { name: 'Recent limit changes' })).toContainText('PM');
  const aud = await as(browser, info, c, 'AUD', 'e2e-audl', '/admin/authority-limits');
  await expect(aud.getByTestId('al-PM-PO')).toContainText('30,00,000');
  await expect(aud.getByLabel('Limit of PM for PO in rupees')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('FR-05 AC-02 delegations from the browser: delegate, see it listed, end it; a long one waits for the manager', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(120_000);
  const c = await company(request, 'MXD');
  const pm = await as(browser, info, c, 'PM', 'e2e-pmd', '/workflow/delegations');
  const errors = watch(pm);
  await expect(pm.getByRole('heading', { name: 'Delegations', level: 1 })).toBeVisible();
  await expect(pm.getByText('No delegation')).toBeVisible();
  await pm.getByRole('button', { name: 'New delegation' }).first().click();
  await pm.getByLabel('Delegate to (user name)').fill('e2e-cover');
  await pm.getByLabel('Reason').fill('Away at the head office review');
  await pm.getByRole('button', { name: 'Delegate', exact: true }).click();
  await expect(pm.getByTestId('dl-notice')).toContainText('in force');
  await expect(pm.getByRole('table')).toContainText('e2e-cover');
  // the delegate decides in the name of the project manager
  const doc = await api(request, c, 'PD', 'e2e-pdd', 'post', '/eng/sample-docs', { title: 'Cover test', amount: '500.00' });
  const wf = (await api(request, c, 'PD', 'e2e-pdd', 'post', `/eng/sample-docs/${doc.id}/submit`, {})).workflow;
  const cover = await as(browser, info, c, 'SE', 'e2e-cover', `/workflow/instance?id=${wf.id}`);
  await cover.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(cover.getByTestId('wi-notice')).toContainText('approved');
  // ending it
  await pm.getByRole('button', { name: /^End/ }).click();
  await pm.getByTestId('confirm-dialog').getByRole('button', { name: 'End the delegation' }).click();
  await expect(pm.getByTestId('dl-notice')).toContainText('ended');
  // more than 15 days: waits
  await pm.getByRole('button', { name: 'New delegation' }).first().click();
  await pm.getByLabel('Delegate to (user name)').fill('e2e-cover');
  const to = new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10);
  await pm.getByLabel('To', { exact: true }).fill(to);
  await pm.getByLabel('Reason').fill('A long leave');
  await pm.getByRole('button', { name: 'Delegate', exact: true }).click();
  await expect(pm.getByTestId('dl-notice')).toContainText('manager must approve');
  await expect(pm.getByRole('table')).toContainText('Waiting for the manager');
  expect(errors).toEqual([]);
});

test('FR-06 FR-07 the escalation hierarchy and the SLA settings are shown and changed through approval', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  test.setTimeout(120_000);
  const c = await company(request, 'MXE');
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-syse', '/admin/escalation');
  const errors = watch(sys);
  await expect(sys.getByRole('heading', { name: 'Escalation Paths & SLA', level: 1 })).toBeVisible();
  await expect(sys.getByLabel('Level 5 name')).toHaveValue('Director');
  await expect(sys.getByLabel('Level 1 name')).toHaveValue('Site');
  await expect(sys.getByTestId('sla-PAY')).toBeVisible();
  await sys.getByLabel('Working hours for PAY').fill('6');
  const form = sys.getByRole('form', { name: 'Ask for a change of the SLA settings' });
  await form.getByLabel('Reason').fill('Payments are paid faster now');
  await form.getByRole('button', { name: 'Ask for approval' }).click();
  await expect(sys.getByRole('heading', { name: 'Workflow Instance', level: 1 })).toBeVisible();
  const id = new URL(sys.url()).searchParams.get('id');
  await approve(request, c, await api(request, c, 'SYSADM', 'e2e-syse', 'get', `/workflow/instances/${id}`), [['SYSADM', 'e2e-syse2'], ['CFO', 'e2e-cfoe']]);
  await sys.goto('/admin/escalation');
  await expect(sys.getByLabel('Working hours for PAY')).toHaveValue('6');
  expect(errors).toEqual([]);
});

test('FR-08 AC-03 on a phone: the simulator runs and no page scrolls sideways', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'desktop', 'the phone-width pass');
  test.setTimeout(120_000);
  const c = await company(request, 'MXM');
  const sim = await as(browser, info, c, 'SYSADM', 'e2e-sysm', '/admin/approval-simulator');
  const errors = watch(sim);
  await sim.getByLabel('Document type').selectOption('PO');
  await sim.getByLabel('Value').first().fill('9000000');
  await sim.getByRole('button', { name: 'Show the chain' }).click();
  await expect(sim.getByTestId('as-steps')).toContainText(/project director/i);
  await noOverflow(sim);
  for (const path of ['/admin/approval-matrix', '/admin/authority-limits', '/workflow/delegations', '/admin/escalation']) {
    await sim.goto(path);
    await expect(sim.locator('main h1')).toBeVisible();
    await noOverflow(sim);
  }
  expect(errors).toEqual([]);
});

test('AC-04 who sees what: an employee without the right gets the no-permission state', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'one pass at desktop width');
  const c = await company(request, 'MXP');
  const sk = await as(browser, info, c, 'SK', 'e2e-skm', '/admin/approval-matrix');
  await expect(sk.getByText(/not allowed|permission/i).first()).toBeVisible();
  await sk.goto('/admin/authority-limits');
  await expect(sk.getByText(/not allowed|permission/i).first()).toBeVisible();
  const aud = await as(browser, info, c, 'AUD', 'e2e-audm', '/admin/approval-matrix');
  await expect(aud.getByTestId('am-new')).toHaveCount(0);
});
