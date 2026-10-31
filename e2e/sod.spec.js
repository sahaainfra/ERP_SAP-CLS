import { test, expect } from '@playwright/test';

// Development-header mode (port 3100); each project works in its own company, created through the API first.
// The flows that need a signed-in reviewer or requester (elevation, review campaign end to end) are covered by tests/sod-api.test.js.
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
const open = async (page, company, roles, path, user = 'e2e-sod') => {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
};

test('SoD rules: the ten standard rules, filtering, a rule opened, a new rule proposed and approved by the auditor', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'SODDESK', 'SODMOB'));
  const code = pick(info, 'SOD-81', 'SOD-82');
  const errors = watch(page);
  await open(page, company, 'SYSADM', '/admin/sod/rules', 'e2e-sodadmin');
  await expect(page.getByRole('heading', { name: 'Segregation of Duties Rules' })).toBeVisible();
  await expect(page).toHaveTitle(/Segregation of Duties Rules/);
  await expect(page.getByText('10 rules, page 1 of 1')).toBeVisible();
  await expect(page.getByTestId('rule-SOD-01')).toContainText('Blocks');
  await expect(page.getByTestId('rule-SOD-07')).toContainText('Warns');
  await noOverflow(page);

  await page.locator('select[aria-label="Severity"]').selectOption('WARN');
  await expect(page.getByText('1 rules, page 1 of 1')).toBeVisible();
  await page.locator('select[aria-label="Severity"]').selectOption('');
  await page.getByRole('button', { name: 'Open rule SOD-02' }).click();
  await expect(page.getByTestId('rule-detail')).toContainText('vendor');
  await expect(page.getByTestId('rule-detail')).toContainText('Side A');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('rule-test')).toBeVisible();

  // propose a rule; it does not exist until the auditor approves
  await page.getByRole('button', { name: 'Propose a rule' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.locator('input[name=code]').fill('x');
  await dlg.locator('input[name=name]').fill('E2E rule');
  await dlg.locator('textarea[name=setA]').fill('claim.prepare');
  await dlg.locator('textarea[name=setB]').fill('claim.verify');
  await dlg.locator('textarea[name=reason]').fill('A rule added by the end-to-end test');
  await dlg.getByRole('button', { name: 'Send for approval' }).click();
  await expect(dlg.getByRole('alert').first()).toBeVisible(); // a bad code is refused, naming the field
  await dlg.locator('input[name=code]').fill(code);
  await dlg.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByTestId('rule-notice')).toContainText('waits for the auditor or the director');
  await expect(page.getByText('10 rules, page 1 of 1')).toBeVisible();
  const list = await (await request.get('/api/v1/core/change-requests?filter[type]=iam_sod_rule_change', { headers: H('AUD', company, 'e2e-aud') })).json();
  const pending = list.data.find((r) => r.status === 'SUBMITTED');
  expect(pending, 'a pending rule change').toBeTruthy();
  expect(pending.chain).toEqual(['AUD|DIR']);
  const wrong = await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: H('SYSADM', company, 'e2e-sodadmin'), data: { action: 'approve', comment: 'checked and fine' } });
  expect(wrong.status(), 'the requester is not the checker').toBe(403);
  const ok = await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: H('AUD', company, 'e2e-aud'), data: { action: 'approve', comment: 'checked and fine' } });
  expect(ok.status(), await ok.text()).toBe(200);
  await page.reload();
  await expect(page.getByText('11 rules, page 1 of 1')).toBeVisible();
  await expect(page.getByTestId(`rule-${code}`)).toContainText('E2E rule');
  expect(errors).toEqual([]);
});

test('SoD violations: the report, a scan, the dormant tab and the person without the right', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'SVIDESK', 'SVIMOB'));
  const errors = watch(page);
  await open(page, company, 'AUD', '/admin/sod/violations', 'e2e-aud');
  await expect(page.getByRole('heading', { name: 'Violations & Dormant Accounts' })).toBeVisible();
  await expect(page.getByTestId('violation-summary')).toContainText('Open');
  await expect(page.getByRole('heading', { name: 'No violations' })).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Scan now' }).click();
  await expect(page.getByTestId('violation-notice')).toContainText('conflict(s) found');
  await page.getByRole('tab', { name: 'Dormant accounts' }).click();
  await expect(page.getByText(/after 90 days without a sign-in/)).toBeVisible();
  await expect(page.getByText(/only reports them/)).toBeVisible();
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByTestId('dormant-notice')).toContainText('0 suspended');
  await noOverflow(page);
  expect(errors).toEqual([]);

  // an ordinary employee has no menu entry and the page explains
  const emp = await page.context().newPage();
  await open(emp, company, 'EMP', '/admin/sod/violations', 'e2e-emp');
  await expect(emp.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'SoD Violations' })).toHaveCount(0);
  await emp.close();
});

test('Elevated access and access reviews: the pages, their empty states and the refusals they show', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'ELEDESK', 'ELEMOB'));
  const errors = watch(page);
  // asking for elevated access needs a signed-in person; in development-header mode there is none, and the page says so
  await open(page, company, 'PM', '/account/elevation', 'e2e-pm');
  await expect(page.getByRole('heading', { name: 'Request Elevated Access' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No requests' })).toBeVisible();
  await page.locator('select[name=roleId]').selectOption({ label: 'AUD - Internal Auditor' });
  await page.locator('textarea[name=reason]').fill('Looking into a duplicate payment query');
  await page.getByRole('button', { name: 'Send the request' }).click();
  await expect(page.getByRole('alert').first()).toContainText('signed-in');
  await noOverflow(page);

  await open(page, company, 'ITADM', '/admin/elevation-approvals', 'e2e-it');
  await expect(page.getByRole('heading', { name: 'Elevation Approvals' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nothing is waiting for you' })).toBeVisible();
  await page.getByRole('tab', { name: 'In force' }).click();
  await expect(page.getByRole('heading', { name: 'No elevations' })).toBeVisible();

  await open(page, company, 'AUD', '/admin/access-reviews', 'e2e-aud');
  await expect(page.getByRole('heading', { name: 'Access Reviews' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No campaigns' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a campaign' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.locator('select[name=scope]').selectOption('ALL');
  await dlg.getByRole('button', { name: 'Start the campaign' }).click();
  await expect(dlg.getByRole('alert')).toContainText('nothing to review');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await noOverflow(page);

  await open(page, company, 'PM', '/account/access-review', 'e2e-pm');
  await expect(page.getByRole('heading', { name: 'My Access Review' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nothing to review' })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});
