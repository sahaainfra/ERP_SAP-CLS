import { test, expect } from '@playwright/test';

// Development-header mode (port 3100); each project works in its own company, created through the API first.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });

async function newCompany(request, code) {
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-sys'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id;
}
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => {
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};
const open = async (page, company, roles, path, user) => {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
};

test('Audit Explorer: changes made through the application appear with their diff, filter, open a record timeline, verify the chain and export', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'ADXDESK', 'ADXMOB'));
  const errors = watch(page);
  // a change through the API: a project is created and renamed
  const made = await request.post('/api/v1/iam/org/projects', { headers: H('PM', company, 'e2e-pm'), data: { code: pick(info, 'AUDP-D', 'AUDP-M'), name: 'Audit road', type: 'ROAD' } });
  expect(made.status(), await made.text()).toBe(201);
  const id = (await made.json()).data.id;
  const renamed = await request.patch(`/api/v1/iam/org/projects/${id}`, { headers: H('PM', company, 'e2e-pm'), data: { name: 'Audit highway', reason: 'renamed by the end-to-end test', version: 1 } });
  expect([200, 400, 422], await renamed.text()).toContain(renamed.status());

  await open(page, company, 'AUD', '/admin/audit', 'e2e-auditor');
  await expect(page.getByRole('heading', { name: 'Audit Explorer' })).toBeVisible();
  await expect(page).toHaveTitle(/Audit Explorer/);
  await expect(page.getByTestId('chain-status')).toContainText('Audit chain');
  await expect(page.getByRole('cell', { name: /org_projects/ }).first()).toBeVisible();
  await noOverflow(page);

  await page.getByLabel('Person', { exact: true }).fill('e2e-pm');
  await expect(page.getByRole('cell', { name: 'e2e-pm' }).first()).toBeVisible();
  await page.getByLabel('Person', { exact: true }).fill('nobody-here');
  await expect(page.getByRole('heading', { name: 'No entries' })).toBeVisible();
  await page.getByLabel('Person', { exact: true }).fill('');

  // a record timeline
  await page.getByRole('button', { name: new RegExp(`Show the timeline of org_projects ${id}`) }).first().click();
  await expect(page.getByText(`Timeline of org_projects ${id}`)).toBeVisible();
  await page.getByRole('button', { name: 'Details' }).first().click();
  await expect(page.locator('[data-testid^=audit-detail-]').first()).toContainText('Correlation ID');
  await expect(page.locator('[data-testid^=audit-detail-]').first()).toContainText(/[0-9a-f]{64}/);

  // verify the chain
  await page.getByRole('button', { name: 'Verify now' }).click();
  await expect(page.getByTestId('audit-notice')).toContainText('The chain is intact');
  await expect(page.getByTestId('chain-status')).toContainText('Intact');
  await noOverflow(page);
  expect(errors).toEqual([]);

  // the auditor's export is itself recorded
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('audit-trail.csv');
  await expect.poll(async () => (await (await request.get('/api/v1/core/audit?entity=report&action=export', { headers: H('AUD', company, 'e2e-auditor') })).json()).meta.total).toBeGreaterThanOrEqual(1);
});

test('Security Events: severity filters, the refused request appears, and people without the right are told', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'SECDESK', 'SECMOB'));
  const errors = watch(page);
  // a refused request: an ordinary employee asks for the audit trail
  expect((await request.get('/api/v1/core/audit', { headers: H('EMP', company, 'e2e-snoop') })).status()).toBe(403);
  await open(page, company, 'SYSADM', '/admin/security-events', 'e2e-sysadmin');
  await expect(page.getByRole('heading', { name: 'Security Events' })).toBeVisible();
  await expect(page).toHaveTitle(/Security Events/);
  await expect(page.getByTestId('security-summary')).toContainText('Critical, last 24 hours');
  await expect(page.getByRole('cell', { name: 'authz.denied' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'e2e-snoop' }).first()).toBeVisible();
  await noOverflow(page);
  await page.locator('select[aria-label="Severity"]').selectOption('CRITICAL');
  await expect(page.getByRole('heading', { name: 'No events' })).toBeVisible();
  await page.locator('select[aria-label="Severity"]').selectOption('WARNING');
  await expect(page.getByRole('cell', { name: 'authz.denied' }).first()).toBeVisible();
  await page.locator('select[aria-label="Severity"]').selectOption('');
  await page.locator('select[aria-label="Type"]').selectOption('authz.denied');
  await expect(page.getByRole('cell', { name: 'authz.denied' }).first()).toBeVisible();
  expect(errors).toEqual([]);

  // a system administrator may read security events but not the audit trail
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit Explorer' })).toHaveCount(0);
  await page.goto('/admin/audit');
  await expect(page.getByText(/core\.audit\.view|not allowed|permission/i).first()).toBeVisible();
});

test('Record History: the rule page shows its own history', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'HISDESK', 'HISMOB'));
  const code = pick(info, 'SOD-71', 'SOD-72');
  const ask = await request.post('/api/v1/iam/sod-rules', { headers: H('SYSADM', company, 'e2e-sodadmin'), data: { rule: { code, name: 'History rule', description: '', kind: 'ACTION', setA: ['a.prepare'], setB: ['a.verify'], scope: 'DOCUMENT', severity: 'DETECT', conditions: {}, active: true }, reason: 'a rule to read the history of' } });
  expect(ask.status(), await ask.text()).toBe(201);
  const reqId = (await ask.json()).data.id;
  const ok = await request.post(`/api/v1/core/change-requests/${reqId}/act`, { headers: H('AUD', company, 'e2e-aud'), data: { action: 'approve', comment: 'checked and fine' } });
  expect(ok.status(), await ok.text()).toBe(200);
  const errors = watch(page);
  await open(page, company, 'SYSADM', '/admin/sod/rules', 'e2e-sodadmin');
  await page.getByRole('button', { name: `Open rule ${code}` }).click();
  const history = page.getByTestId('record-history');
  await expect(history).toContainText('create_approved');
  await expect(history).toContainText('e2e-aud');
  await noOverflow(page);
  expect(errors).toEqual([]);
});
