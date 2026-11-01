import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). The List Report (part 03.03) on the reference register: quick filters, totals, the column
// chooser kept per person, a saved default view, bulk submit with its result, an export download, row links, masks for the system
// administrator, cards on a phone (T-04), My Exports and the component's documentation page.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const open = async (page, company, roles, path, user) => {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
};

/** A company with numbering, a project and 12 requests: 8 submitted, 4 drafts. */
async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => {
    const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const current = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup') });
  const version = current.ok() ? (await current.json()).data?.version : undefined; // other specs use fixed company ids, so settings may exist
  const put = await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } });
  expect(put.status(), await put.text()).toBe(200);
  await post('/core/financial-years', 'SYSADM', company, { startDate: '2026-04-01' });
  await post('/core/number-series', 'SYSADM', company, { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' });
  const project = await post('/iam/org/projects', 'PM', company, { code: `${code}-P`, name: 'NH-48 Widening', type: 'ROAD' });
  for (let i = 1; i <= 12; i += 1) {
    const r = await post('/ui/sample-requests', 'PM', company, { title: `Lot ${i} ${i % 2 ? 'cement' : 'steel'}`, docDate: `2026-10-${String(i + 10).padStart(2, '0')}`, requiredBy: '2026-11-20', projectId: project.id, lines: [{ description: 'Cement OPC 53', uom: 'BAG', quantity: String(i * 10), unitRate: '400' }] }, i % 3 === 0 ? 'e2e-other' : 'e2e-pm');
    if (i <= 8) await post(`/ui/sample-requests/${r.id}/submit`, 'PM', company, { version: r.version }, i % 3 === 0 ? 'e2e-other' : 'e2e-pm'); // only the person who raised a request submits it
  }
  return { company };
}

test('List Report on the reference register: filters, totals, columns kept, a default view, bulk submit, export and row links', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  test.skip(info.project.name === 'mobile', 'the phone layout has its own test');
  const w = await world(request, 'LRD');
  const errors = watch(page);
  await open(page, w.company, 'PM', '/admin/sample-requests', 'e2e-pm');
  const list = page.getByTestId('list-ui.sample_requests');
  await expect(page.getByText('12 requests, page 1 of 1')).toBeVisible();
  await expect(page.getByTestId('total-total')).toHaveText('3,12,000.00');
  // quick filter: drafts; the totals follow
  await page.getByRole('button', { name: 'Draft', exact: true }).click();
  await expect(page.getByText('4 requests, page 1 of 1')).toBeVisible();
  await expect(page.getByTestId('total-total')).toHaveText('1,68,000.00');
  await expect(list.getByRole('listitem').filter({ hasText: 'Status is one of Draft' })).toBeVisible();
  // the advanced builder: total at least 44,000 (requests 11 and 12)
  await page.getByText('More filters').click();
  await page.getByRole('form', { name: 'Add a filter' }).getByLabel('Field').selectOption({ label: 'Total (₹)' });
  await page.getByRole('form', { name: 'Add a filter' }).getByLabel('Operator').selectOption('gte');
  await page.getByRole('form', { name: 'Add a filter' }).getByLabel('Value').fill('44000');
  await page.getByRole('button', { name: 'Add filter' }).click();
  await expect(page.getByText('2 requests, page 1 of 1')).toBeVisible();
  await page.getByRole('button', { name: /Remove the filter Total/ }).click();
  await expect(page.getByText('4 requests, page 1 of 1')).toBeVisible();
  // bulk submit two drafts, one of them somebody else's: one is done, one is refused, and the result says which and why
  await page.getByRole('checkbox', { name: 'Select every row on this page' }).check();
  await page.locator('tbody input[type=checkbox]').nth(0).uncheck();
  await page.locator('tbody input[type=checkbox]').nth(1).uncheck();
  await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');
  await page.getByRole('button', { name: 'Submit selected' }).click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Submit selected' }).click();
  await expect(page.getByTestId('bulk-result')).toContainText('Submit selected: 1 done, 1 not done.');
  await expect(page.getByTestId('bulk-result')).toContainText('Only e2e-other, who raised this request, can submit it');
  await expect(page.getByText('3 requests, page 1 of 1')).toBeVisible();
  // hide a column; it stays hidden after a reload (kept per person)
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.getByTestId('column-chooser').locator('summary').click();
  await page.getByTestId('column-chooser').getByRole('checkbox', { name: 'Site' }).uncheck();
  await expect(list.getByRole('columnheader', { name: 'Site' })).toHaveCount(0);
  // a default view: submitted only, sorted by total
  await page.getByRole('button', { name: 'Submitted', exact: true }).click();
  await page.getByRole('button', { name: /^Total \(₹\)/ }).click();
  await page.getByTestId('views-menu').locator('summary').click();
  await page.getByLabel('View name').fill('Submitted by value');
  await page.getByLabel('Open with this view').check();
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByTestId('list-notice')).toContainText('View "Submitted by value" saved.');
  await page.reload();
  await expect(page.getByText('9 requests, page 1 of 1')).toBeVisible();
  await expect(page.getByTestId('views-menu').locator('summary')).toContainText('View: Submitted by value');
  await expect(list.getByRole('columnheader', { name: 'Site' })).toHaveCount(0);
  await expect(list.getByRole('columnheader', { name: /Total/ })).toHaveAttribute('aria-sort', 'ascending');
  // export the current view as Excel
  await page.getByTestId('export-menu').locator('summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'XLSX' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^ui-sample_requests-\d{8}-\d{4}\.xlsx$/);
  await expect(page.getByTestId('list-notice')).toContainText('Exported 9 rows as XLSX');
  // a row link opens the request (and would open in a new tab with a middle click)
  const first = list.locator('tbody tr').first().locator('a').first();
  await expect(first).toHaveAttribute('href', /\/admin\/sample-requests\?open=\d+/);
  await first.click();
  await expect(page.getByRole('heading', { name: /^MR\/2026-27\/\d{4}$/ })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('the system administrator sees the commercial total masked, also in the totals and the export', async ({ page, request }, info) => {
  const w = await world(request, pick(info, 'LRSD', 'LRSM'));
  await open(page, w.company, 'SYSADM', '/admin/sample-requests', pick(info, 'e2e-sys-d', 'e2e-sys-m'));
  await expect(page.getByText('12 requests, page 1 of 1')).toBeVisible();
  if (info.project.name === 'desktop') {
    await expect(page.getByTestId('total-total')).toHaveText('•••');
    await expect(page.getByRole('columnheader', { name: /Total/ }).getByRole('button')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('list-cards')).toContainText('•••');
  }
  const csv = await request.get('/api/v1/ui/sample-requests/export?format=csv', { headers: H('SYSADM', w.company, 'e2e-sys') });
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain('•••');
  expect(text).not.toContain('312000');
});

test('T-04 cards at phone width without horizontal page scroll; My Exports and the List Report documentation', async ({ page, request }, info) => {
  const w = await world(request, pick(info, 'LRMD', 'LRMM'));
  const errors = watch(page);
  await open(page, w.company, 'PM', '/admin/sample-requests', 'e2e-pm');
  await expect(page.getByText('12 requests, page 1 of 1')).toBeVisible();
  if (info.project.name === 'mobile') {
    await expect(page.getByTestId('list-cards')).toBeVisible();
    await expect(page.locator('.lr-card')).toHaveCount(12);
    await expect(page.getByTestId('list-totals')).toContainText('Total of 12 rows');
    await page.getByRole('button', { name: 'My records' }).click();
    await expect(page.getByText('8 requests, page 1 of 1')).toBeVisible();
  } else {
    await expect(page.getByTestId('list-cards')).toHaveCount(0);
  }
  await noOverflow(page);
  await page.goto('/account/exports');
  await expect(page.getByRole('heading', { name: 'My Exports', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No background exports' })).toBeVisible();
  await noOverflow(page);
  await open(page, w.company, 'SYSADM', '/admin/design-system/lists', 'e2e-docs');
  await expect(page.getByRole('heading', { name: 'List Report', exact: true })).toBeVisible();
  await expect(page.locator('code', { hasText: /^total$/ })).toBeVisible();
  await expect(page.getByText('Total (₹) (masked for you)')).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});
