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
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => {
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};
const open = async (page, company, roles, path, user = 'e2e-sys') => {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
};
const decide = async (request, company, type, roles, user) => {
  const list = await (await request.get(`/api/v1/core/change-requests?filter[type]=${type}`, { headers: H(roles, company, user) })).json();
  const pending = list.data.filter((r) => r.status === 'SUBMITTED').at(-1);
  expect(pending, `a pending ${type} request`).toBeTruthy();
  const res = await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: H(roles, company, user), data: { action: 'approve', comment: 'checked and fine' } });
  expect(res.status(), await res.text()).toBe(200);
};

test('Roles: system templates are locked, a clone is edited in the matrix, approved, activated and compared', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'ROLDESK', 'ROLMOB'));
  const code = pick(info, 'SITELEADA', 'SITELEADB');
  const errors = watch(page);
  await open(page, company, 'SYSADM', '/admin/roles');
  await expect(page.getByRole('heading', { name: 'Roles', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Roles/);
  await expect(page.getByText('44 roles, page 1 of 2')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search roles' }).fill('procmgr');
  await expect(page.getByTestId('role-row-PROCMGR')).toContainText('System (locked)');
  await page.getByRole('searchbox', { name: 'Search roles' }).fill('');
  await page.locator('select[aria-label="Kind"]').selectOption('CUSTOM');
  await expect(page.getByRole('heading', { name: 'No roles' })).toBeVisible();
  await page.locator('select[aria-label="Kind"]').selectOption('');

  // a system role opens read-only
  await page.getByRole('searchbox', { name: 'Search roles' }).fill('PM');
  await page.getByRole('link', { name: 'PM', exact: true }).click();
  await expect(page.getByTestId('locked-note')).toBeVisible();
  await expect(page.getByRole('button', { name: /Request/ })).toHaveCount(0);
  await expect(page.getByTestId('cell-org.view')).toContainText('Allow');
  await expect(page.getByTestId('cell-core.fy.view')).toContainText('-');
  await page.getByRole('button', { name: 'Back to the list' }).click();

  // clone it
  await page.getByRole('button', { name: 'Clone PM', exact: true }).click();
  await page.locator('dialog[open] input[name=code]').fill(code.toLowerCase());
  await page.locator('dialog[open] input[name=name]').fill('Site lead');
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByTestId('roles-notice')).toContainText(`The custom role ${code} was created as a draft`);
  await page.getByRole('searchbox', { name: 'Search roles' }).fill(code);
  await expect(page.getByTestId(`role-row-${code}`)).toContainText('Draft');
  // the same code twice is refused with a message
  await page.getByRole('button', { name: `Clone ${code}` }).click();
  await page.locator('dialog[open] input[name=code]').fill(code);
  await page.locator('dialog[open] input[name=name]').fill('Again');
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.locator('dialog[open]')).toContainText('already exists');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // edit the matrix, then ask for activation
  await page.getByRole('link', { name: code, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Site lead', level: 1 })).toBeVisible();
  await expect(page.getByTestId('locked-note')).toHaveCount(0);
  const summary = page.getByTestId('matrix-summary');
  const before = await summary.textContent();
  await page.getByTestId('cell-core.fy.view').click();
  await expect(page.getByTestId('cell-core.fy.view')).toContainText('Allow');
  await page.getByTestId('cell-core.numbering.preview').click(); // the copy allows it: one click denies it
  await expect(page.getByTestId('cell-core.numbering.preview')).toContainText('Deny');
  expect(await summary.textContent()).not.toBe(before);
  await page.getByRole('tab', { name: 'Field masks' }).click();
  await page.getByLabel('Mask rule for employee.salary').selectOption('show');
  await page.getByRole('button', { name: 'Request activation' }).click();
  await page.locator('dialog[open] textarea[name=reason]').fill('The role the site leads need');
  await page.getByRole('button', { name: 'Raise the request' }).click();
  await expect(page.getByTestId('role-notice')).toContainText('needs ITADM then DIR');
  await expect(page.getByRole('tabpanel')).toContainText('waiting for a decision');
  await expect(page.getByTestId('role-status')).toContainText('Draft');

  // the checker and the director approve; the role becomes active with what was asked
  await decide(request, company, 'iam_role_change', 'ITADM', 'e2e-it');
  await decide(request, company, 'iam_role_change', 'DIR', 'e2e-dir');
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await page.getByRole('searchbox', { name: 'Search roles' }).fill(code);
  await page.getByRole('link', { name: code, exact: true }).click();
  await expect(page.getByTestId('role-status')).toContainText('Active');
  await expect(page.getByTestId('cell-core.numbering.preview')).toContainText('Deny');
  await expect(page.getByTestId('cell-core.fy.view')).toContainText('Allow');
  await page.getByRole('tab', { name: 'Approvals' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('approved by');
  await page.getByRole('tab', { name: 'Users holding it' }).click();
  await expect(page.getByRole('heading', { name: 'Nobody holds this role' })).toBeVisible();

  // compare the template with the copy
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await page.getByRole('searchbox', { name: 'Search roles' }).fill('');
  await page.getByRole('searchbox', { name: 'Search roles' }).fill('PM');
  await page.getByLabel('Select PM to compare').check();
  await page.getByRole('searchbox', { name: 'Search roles' }).fill(code);
  await page.getByLabel(`Select ${code} to compare`).check();
  await expect(page.getByTestId('role-compare')).toContainText(`PM compared with ${code}`);
  await expect(page.getByTestId('role-compare')).toContainText('core.fy.view');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('roles.csv');
  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Assignments, effective permissions and the legacy comparison', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'ASNDESK', 'ASNMOB'));
  const tag = pick(info, 'a', 'b');
  const errors = watch(page);
  const user = await (await request.post('/api/v1/iam/users', { headers: H('HRMGR', company, 'e2e-hr'), data: { displayName: 'Pam Rao', email: `pam.${tag}@example.com` } })).json();
  const project = await (await request.post('/api/v1/iam/org/projects', { headers: H('PM', company, 'e2e-pm'), data: { code: `PA${tag.toUpperCase()}`, name: 'Alpha road', type: 'ROAD' } })).json();
  await request.post('/api/v1/iam/org/projects', { headers: H('PM', company, 'e2e-pm'), data: { code: `PB${tag.toUpperCase()}`, name: 'Bravo bridge', type: 'BRIDGE' } });
  expect(project.data.id).toBeTruthy();
  await open(page, company, 'SYSADM', '/admin/assignments');
  await expect(page.getByRole('heading', { name: 'Assignments', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No assignments' })).toBeVisible();

  // ask for a role for one project only
  await page.locator('select[name=userId]').selectOption({ label: `Pam Rao (pam.${tag})` });
  await page.locator('select[name=roleId]').selectOption({ label: 'PM - Project Manager' });
  await page.locator('select[name=scopeType]').selectOption('PROJECT');
  await page.locator('form[aria-labelledby=assign-title] textarea[name=reason]').fill('Runs the Alpha road project');
  await page.getByRole('button', { name: 'Raise the request' }).click();
  await expect(page.getByText('Choose at least one project.')).toBeVisible();
  await page.getByLabel(`PA${tag.toUpperCase()} Alpha road`).check();
  await page.getByRole('button', { name: 'Raise the request' }).click();
  await expect(page.getByTestId('assign-notice')).toContainText('needs ITADM then DIR');
  await expect(page.getByTestId('assign-notice')).toContainText(`Give PM to pam.${tag} (project PA${tag.toUpperCase()})`);
  await decide(request, company, 'iam_assignment', 'ITADM', 'e2e-it');
  await decide(request, company, 'iam_assignment', 'DIR', 'e2e-dir');
  await page.reload();
  const row = page.locator('tbody tr', { hasText: `pam.${tag}` });
  await expect(row).toContainText(`Projects: PA${tag.toUpperCase()}`);
  await expect(row).toContainText('In force');

  // why can she, and where
  await page.goto(`/admin/effective-access?userId=${user.data.id}`);
  await expect(page.getByRole('heading', { name: 'Effective Permissions', exact: true })).toBeVisible();
  await expect(page.getByTestId('eff-org.view')).toContainText('Allowed');
  await expect(page.getByTestId('eff-org.view')).toContainText('part of the company');
  await expect(page.getByTestId('eff-core.settings.configure')).toContainText('Refused');
  await page.locator('select[aria-label="Record type"]').selectOption('project');
  await page.getByLabel('Record number').fill(String(project.data.id));
  await expect(page.getByTestId('eff-record')).toContainText('Alpha road');
  await expect(page.getByTestId('eff-org.project.manage')).toContainText('inside the scope');
  await page.getByLabel('Record number').fill('999');
  await expect(page.getByRole('alert')).toContainText('does not exist');
  await page.getByLabel('Record number').fill(String(project.data.id + 1));
  await expect(page.getByTestId('eff-org.project.manage')).toContainText('outside the scope');
  await page.locator('select[aria-label="Show"]').selectOption('allowed');
  await expect(page.getByTestId('eff-core.settings.configure')).toHaveCount(0);

  // the legacy comparison
  await page.goto('/admin/legacy-access');
  await expect(page.getByRole('heading', { name: 'Legacy Access Comparison', exact: true })).toBeVisible();
  await expect(page.getByTestId('legacy-verdict')).toContainText('Clean');
  await expect(page.getByTestId('legacy-lost-access')).toHaveText('0');
  await expect(page.getByTestId('legacy-gained-access')).toHaveText('0');
  await expect(page.getByRole('heading', { name: 'Where each old role went' })).toBeVisible();
  await expect(page.getByText('Same role, same code').first()).toBeVisible();

  // end the assignment
  await page.goto('/admin/assignments');
  await page.getByRole('button', { name: new RegExp(`End the assignment of PM to pam.${tag}`) }).click();
  await page.locator('dialog[open] textarea[name=reason]').fill('Moved to another project');
  await page.getByRole('button', { name: 'End the assignment', exact: true }).click();
  await expect(page.getByTestId('assign-notice')).toContainText('has ended');
  await expect(page.getByRole('heading', { name: 'No assignments' })).toBeVisible();
  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Roles: a role that may only read is shown the pages without the buttons', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'AUDDESK', 'AUDMOB'));
  const errors = watch(page);
  await open(page, company, 'AUD', '/admin/roles', 'e2e-aud');
  await expect(page.getByRole('heading', { name: 'Roles', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New role' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Clone/ })).toHaveCount(0);
  await page.goto('/admin/assignments');
  await expect(page.getByRole('heading', { name: 'Assignments', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assign a role' })).toHaveCount(0);
  await page.goto('/admin/legacy-access');
  await expect(page.getByTestId('legacy-verdict')).toBeVisible();
  const hr = page.context().newPage();
  await (await hr).close();
  expect(errors).toEqual([]);
});
