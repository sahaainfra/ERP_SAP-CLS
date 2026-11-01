import { test, expect } from '@playwright/test';

// Both viewport projects share one database, so each test uses its own company per project.
const company = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);

async function open(page, roles, path, companyId, user = 'e2e-ops') {
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

const headers = (roles, companyId, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': companyId, 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}` });

test('Monitor: key figures, consumers, the event log with masked data, and the catalogue', async ({ page, request }, info) => {
  const companyId = company(info, '51', '52');
  // Raise real events: saving the company settings writes core.company_settings.changed in the same transaction.
  // the company id is fixed, and another spec may have used the same number for a company of its own: send the version of the settings if there are some
  const current = await request.get('/api/v1/core/company-settings', { headers: headers('SYSADM', companyId, 'e2e-sys') });
  const version = current.ok() ? (await current.json()).data?.version : undefined;
  const saved = await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', companyId, 'e2e-sys'), data: { legalName: 'Ops Test Pvt Ltd', pan: 'AAPCS1234F', reason: 'events for the monitor', ...(version ? { version } : {}) } });
  expect(saved.status()).toBe(200);
  const errors = await open(page, 'ITADM', '/admin/operations', companyId);
  await expect(page.getByRole('heading', { name: 'Events & Jobs Monitor' })).toBeVisible();
  await expect(page).toHaveTitle(/Events & Jobs Monitor/);
  await expect(page.getByTestId('tile-dead')).toHaveText('0');
  await expect(page.getByTestId('consumer-core.projection.event_counts')).toBeVisible();
  const row = page.getByTestId(/^event-/).filter({ hasText: 'core.company_settings.changed' }).first();
  await expect(row).toBeVisible();
  await row.getByText('Show').click();
  await expect(row.locator('pre')).toContainText('currency');
  await page.getByText('Event catalogue').click();
  await expect(page.getByRole('cell', { name: 'core.job.failed' }).first()).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Replay: ITADM queues a replay, it runs in the background and the job page shows its log', async ({ page }, info) => {
  const errors = await open(page, 'ITADM', '/admin/operations', company(info, '53', '54'));
  await page.getByRole('button', { name: 'Replay events' }).click();
  const dlg = page.getByRole('dialog', { name: 'Replay events' });
  await dlg.getByLabel(/^Event types/).fill('core.*');
  await dlg.locator('select[name=consumer]').selectOption('core.projection.event_counts');
  await dlg.getByLabel(/Empty the consumer/).check();
  await dlg.getByLabel(/Reason/).fill('rebuild the read model');
  await dlg.getByRole('button', { name: 'Queue replay' }).click();
  await expect(page.getByText(/Replay queued as job \d+/)).toBeVisible();
  await page.getByRole('link', { name: 'Jobs' }).first().click();
  await expect(page.getByRole('heading', { name: 'Background Jobs' })).toBeVisible();
  const row = page.locator('tr', { hasText: 'core.event_replay' }).first();
  await expect(row.getByText('Done')).toBeVisible({ timeout: 15_000 });
  await row.getByText(/\d+ lines/).click();
  await expect(row.locator('pre')).toContainText('Replaying core.*');
  await page.getByTestId('job-status').selectOption('FAILED');
  await expect(page.getByRole('heading', { name: 'No jobs' })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Dead-letter queue: empty state, filters, and view-only for a role that cannot re-drive', async ({ page }, info) => {
  const errors = await open(page, 'SYSADM', '/admin/operations/dead-letters', company(info, '55', '56'), 'e2e-sys');
  await expect(page.getByRole('heading', { name: 'Dead-Letter Queue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No dead letters' })).toBeVisible();
  await page.getByTestId('dlq-status').selectOption('DISCARDED');
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to the monitor' }).click();
  await expect(page.getByRole('heading', { name: 'Events & Jobs Monitor' })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Schedules: ITADM previews a cron and asks for a change; SYSADM approves it and the schedule changes', async ({ page }, info) => {
  const companyId = company(info, '57', '58');
  const errors = await open(page, 'ITADM', '/admin/operations/schedules', companyId, 'e2e-it');
  await expect(page.getByRole('heading', { name: 'Scheduled Jobs' })).toBeVisible();
  const row = page.getByTestId(`schedule-${info.project.name === 'desktop' ? 'core.housekeeping_daily' : 'core.integrity_nightly'}`);
  const code = info.project.name === 'desktop' ? 'core.housekeeping_daily' : 'core.integrity_nightly';
  await expect(row).toContainText('Enabled');
  await page.getByRole('button', { name: `Request a change to ${code}` }).click();
  const dlg = page.getByRole('dialog', { name: `Change ${code}` });
  await dlg.getByLabel(/^Cron expression/).fill('nonsense');
  await expect(dlg.getByTestId('cron-preview')).toContainText('five fields');
  await dlg.getByLabel(/^Cron expression/).fill('15 4 * * *');
  await expect(dlg.getByTestId('cron-preview')).toContainText('Next runs');
  await dlg.getByLabel(/Reason/).fill('move after the backup window');
  await dlg.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByText(/sent for approval/)).toBeVisible();
  await expect(row).toContainText('0 3 * * *'.replace('0 3', code.includes('housekeeping') ? '0 3' : '30 1'));

  const sys = await page.context().newPage();
  await open(sys, 'SYSADM', '/admin/operations/schedules', companyId, 'e2e-sys');
  await expect(sys.getByText('Schedule changes waiting for a decision')).toBeVisible();
  await sys.getByRole('button', { name: 'Approve' }).first().click();
  await expect(sys.getByText(/approved and applied/)).toBeVisible();
  await expect(sys.getByTestId(`schedule-${code}`)).toContainText('15 4 * * *');
  await noOverflow(sys);
  expect(errors.filter((e) => !/400/.test(e))).toEqual([]); // the 400 is the deliberate invalid cron preview
});

test('PM gets the no-access state and no navigation to the console', async ({ page }, info) => {
  await open(page, 'PM', '/admin/operations', company(info, '59', '60'), 'e2e-pm');
  await expect(page.getByTestId('no-permission')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Operations' })).toHaveCount(0);
});
