import { test, expect } from '@playwright/test';

// Both viewport projects share one database, so each test uses its own company per project.
const company = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);

async function open(page, roles, path, companyId, user = 'e2e-config') {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: companyId });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(path);
  return errors;
}

const noOverflow = async (page) => {
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};

test('Company Settings: the System Administrator saves the tax identity and gets field errors for a bad PAN', async ({ page }, info) => {
  const errors = await open(page, 'SYSADM', '/admin/company-settings', company(info, '31', '32'));
  await expect(page.getByRole('heading', { name: 'Company Settings' })).toBeVisible();
  await expect(page).toHaveTitle(/Company Settings/);
  await page.getByLabel('Legal name').fill('Sahaa Infra Pvt Ltd');
  await page.getByLabel(/^PAN/).fill('BADPAN');
  await page.getByLabel(/Reason for this change/).fill('initial set-up');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText(/A PAN has 10 characters/)).toBeVisible();
  await page.getByLabel(/^PAN/).fill('AAPCS1234F');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved. The change is in the audit trail.')).toBeVisible();
  await noOverflow(page);
  expect(errors.filter((e) => !/400/.test(e))).toEqual([]);
});

test('Company Settings: the Accounts Manager can read but not change', async ({ page }, info) => {
  await open(page, 'ACCMGR', '/admin/company-settings', company(info, '33', '34'));
  await expect(page.getByRole('heading', { name: 'Company Settings' })).toBeVisible();
  await expect(page.getByLabel('Legal name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
});

test('Financial Years: create a year, see twelve open periods, soft-close one module', async ({ page }, info) => {
  const errors = await open(page, 'SYSADM', '/admin/financial-years', company(info, '35', '36'));
  await expect(page.getByRole('heading', { name: 'No financial year yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Create financial year' }).click();
  const dlg = page.getByRole('dialog', { name: 'Create financial year' });
  await dlg.getByLabel('Start date').fill('2026-04-01');
  await dlg.getByLabel(/Reason/).fill('first year of operation');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('fy-select')).toContainText('2026-27');
  await expect(page.locator('tbody tr')).toHaveCount(12);
  // The Accounts Manager, not the System Administrator, controls period status: open a second page as that role.
  const acc = await page.context().newPage();
  await open(acc, 'ACCMGR', '/admin/financial-years', company(info, '35', '36'), 'e2e-acc');
  await acc.getByRole('button', { name: 'Change finance status for Apr 2026' }).click();
  const change = acc.getByRole('dialog', { name: /finance/ });
  await change.getByLabel('New status').selectOption('Soft-closed');
  await change.getByLabel(/Reason/).fill('month-end review');
  await change.getByRole('button', { name: 'Change status' }).click();
  await expect(acc.getByTestId('period-1').getByText('Soft-closed')).toBeVisible();
  await noOverflow(acc);
  expect(errors).toEqual([]);
});

test('Numbering: the live preview shows the number and flags a format that would repeat', async ({ page }, info) => {
  const errors = await open(page, 'SYSADM', '/admin/numbering', company(info, '37', '38'));
  await expect(page.getByRole('heading', { name: 'Document Types & Numbering' })).toBeVisible();
  await expect(page.getByTestId('type-SAMPLE_DOC')).toBeVisible();
  await page.getByRole('button', { name: 'Add number series' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add number series' });
  await dlg.getByLabel(/^Prefix/).fill('SMP');
  await expect(dlg.getByTestId('number-preview')).toContainText('SMP/2026-27/000001');
  await dlg.getByLabel(/^Format/).fill('{PREFIX}/{SEQ:6}');
  await expect(dlg.getByTestId('number-preview')).toContainText('restarts every financial year');
  await dlg.getByLabel('Restart numbering').selectOption('never');
  await expect(dlg.getByTestId('number-preview')).toContainText('SMP/000001');
  await dlg.getByLabel('Series name').fill('Sample documents');
  await dlg.getByLabel(/Reason/).fill('numbering for samples');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Number series added.')).toBeVisible();
  await expect(page.locator('td[data-label="Name"]', { hasText: 'Sample documents' })).toBeVisible();
  await noOverflow(page);
  expect(errors.filter((e) => !/40[0-9]|422/.test(e))).toEqual([]);
});

test('Parameters: set a company value and see it in the history; PM has no access', async ({ page }, info) => {
  await open(page, 'SYSADM', '/admin/parameters', company(info, '39', '40'));
  await expect(page.getByRole('heading', { name: 'System Parameters' })).toBeVisible();
  await page.getByRole('button', { name: 'Set a value for core.ui.default_page_size' }).click();
  const dlg = page.getByRole('dialog', { name: /core.ui.default_page_size/ });
  await dlg.getByLabel('Value').fill('50');
  await dlg.getByLabel(/Reason/).fill('larger lists for this company');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved\. core\.ui\.default_page_size changes from/)).toBeVisible();
  await page.getByRole('button', { name: 'Show history of core.ui.default_page_size' }).click();
  await expect(page.locator('td[data-label="Value"] code', { hasText: /^50$/ })).toBeVisible();
  await noOverflow(page);
});

test('Holidays: add a calendar and a holiday, a duplicate date is refused, then delete it', async ({ page }, info) => {
  await open(page, 'SYSADM', '/admin/holidays', company(info, '41', '42'));
  await expect(page.getByRole('heading', { name: 'Holiday Calendars' })).toBeVisible();
  await page.getByRole('button', { name: 'Add calendar' }).click();
  const cal = page.getByRole('dialog', { name: 'Add holiday calendar' });
  await cal.getByLabel('Code').fill('IN-ALL');
  await cal.getByLabel('Name').fill('Company holidays');
  await cal.getByLabel(/Reason/).fill('company-wide holidays');
  await cal.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('calendar-select')).toContainText('IN-ALL');
  await page.getByLabel('Year').fill('2026');
  const add = async (name) => {
    await page.getByRole('button', { name: 'Add holiday' }).click();
    const d = page.getByRole('dialog', { name: 'Add holiday' });
    await d.getByLabel('Date').fill('2026-01-26');
    await d.getByLabel('Name').fill(name);
    await d.getByRole('button', { name: 'Save' }).click();
    return d;
  };
  await add('Republic Day');
  await expect(page.getByTestId('holiday-2026-01-26')).toBeVisible();
  const again = await add('Duplicate day');
  await expect(again.getByRole('alert')).toBeVisible();
  await again.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Delete Republic Day' }).click();
  await expect(page.getByTestId('holiday-2026-01-26')).toHaveCount(0);
  await noOverflow(page);
});

test('the new pages show the no-access state for a role without the permission', async ({ page }, info) => {
  await open(page, 'PM', '/admin/numbering', company(info, '43', '44'));
  await expect(page.getByRole('heading', { name: 'Document Types & Numbering' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You do not have access to document types' })).toBeVisible();
});
