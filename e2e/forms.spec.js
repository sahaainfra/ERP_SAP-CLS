import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). The data-entry framework (part 03.02): the components gallery, the reference form (context
// auto-fill, dependent lookups, paste from Excel, server errors on fields, submit and numbering), drafts after a crash, My Drafts, and a
// form completed with the keyboard alone. Each viewport works in its own company, set up through the API first.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};
const open = async (page, company, roles, path, user, context = null) => {
  await page.addInitScript(([v, c]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); if (c) localStorage.setItem('erp.context', JSON.stringify(c)); }, [{ user, roles, company: String(company) }, context]);
  await page.goto(path);
};

/** Press Tab until the focused element is the one wanted (keyboard only, T-04). */
async function tabTo(page, isIt, max = 60) {
  for (let i = 0; i < max; i += 1) {
    const el = await page.evaluate(() => { const a = document.activeElement; return { id: a?.id ?? '', tagName: a?.tagName ?? '', textContent: a?.textContent ?? '' }; });
    if (isIt(el)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the element');
}

/** A company with a financial year, numbering for the reference form, a project with a site and its cost centre. */
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
  const site = await post('/iam/org/sites', 'PM', company, { code: `${code}-S1`, name: 'Km 12 camp', projectId: project.id });
  await post('/iam/org/cost-centres', 'ACCMGR', company, { code: `${code}-CC`, name: 'Km 12 camp cost', linkedType: 'SITE', linkedId: site.id });
  return { company, project, site };
}

test('Form Components gallery: every field type in five states, the line grid and the live registry', async ({ page }, info) => {
  const errors = watch(page);
  await open(page, 1, 'SYSADM', '/admin/design-system/forms', pick(info, 'e2e-fg-d', 'e2e-fg-m'));
  await expect(page.getByRole('heading', { name: 'Form Components', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Form Components/);
  await expect(page.getByText('21 of 21 components')).toBeVisible();
  for (const i of [0, 5, 9, 15, 18]) await expect(page.getByTestId(`gallery-${i}`)).toBeVisible();
  // the states are real: the error one is announced, the read-only one is text, the disabled one is disabled
  const text = page.getByTestId('gallery-0');
  await expect(text.locator('[role="alert"]')).toContainText('at least 3 characters');
  await expect(text.locator('#g-0-disabled')).toBeDisabled();
  await expect(text.locator('div#g-0-readonly')).toHaveText('Footing F3 reinforcement');
  // a number reads Indian grouping and keeps a plain decimal
  const num = page.locator('#g-1-default');
  await num.fill('1,234,567.5');
  await num.blur();
  await expect(num).toHaveValue('12,34,567.50');
  // the searchable lookup of units in the grid, and the calendar
  await page.locator('#g-5-default').fill('31-12-2026');
  await page.locator('#g-5-default').press('Enter');
  await expect(page.locator('#g-5-default')).toHaveValue('31-Dec-2026');
  await page.getByRole('button', { name: 'Open the calendar for Date (holidays marked)' }).first().click();
  await expect(page.getByRole('dialog', { name: /Choose a date, December 2026/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('total-amount')).toHaveText('1,45,000.00');
  await page.getByText('Units of measure').waitFor();
  await expect(page.locator('caption', { hasText: /^Lookups/ })).toBeVisible();
  await page.getByLabel('Find a component').fill('zzz');
  await expect(page.getByRole('heading', { name: 'No component matches "zzz"' })).toBeVisible();
  await page.getByLabel('Find a component').fill('');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Reference form AC-02 T-01: context auto-fill, dependent lookups, 50 rows pasted from Excel, server errors on fields, submit and numbering', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const w = await world(request, pick(info, 'FRMD', 'FRMM'));
  const errors = watch(page);
  await open(page, w.company, 'PM', '/admin/sample-requests', pick(info, 'e2e-pm-d', 'e2e-pm-m'), { projectId: w.project.id, siteId: w.site.id });
  await expect(page.getByRole('heading', { name: 'Sample Material Requests', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No sample material requests yet' })).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: 'New request' }).first().click();
  await expect(page.getByRole('heading', { name: 'New sample material request' })).toBeVisible();
  // filled from the working context and the masters
  await expect(page.locator('#f-projectId')).toHaveValue(/NH-48 Widening/);
  await expect(page.locator('#f-siteId')).toHaveValue(/Km 12 camp/);
  await expect(page.locator('#f-costCentreId')).toHaveValue(/Km 12 camp cost/);
  await expect(page.locator('div#f-requestedBy')).toHaveText(pick(info, 'e2e-pm-d', 'e2e-pm-m'));
  // the urgent reason appears only when it is urgent
  await expect(page.locator('#f-urgencyReason')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Urgent' }).check();
  await expect(page.locator('#f-urgencyReason')).toBeVisible();
  await page.getByRole('radio', { name: 'Normal' }).check();
  // saving empty: the summary names every problem and links to the field
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const summary = page.getByTestId('error-summary');
  await expect(summary).toContainText('Title');
  await expect(summary).toContainText('Required by');
  await summary.getByRole('link', { name: /Title/ }).click();
  await expect(page.locator('#f-title')).toBeFocused();
  // fill in, and paste 50 rows copied from Excel into the first cell (T-01)
  await page.locator('#f-title').fill('Footing F3 to F7 reinforcement');
  await page.locator('#f-requiredBy').fill('10-11-2026');
  await page.locator('#f-requiredBy').press('Tab');
  const rows = Array.from({ length: 50 }, (_, i) => `TMT bar ${8 + (i % 5) * 4} mm lot ${i + 1}\tMT\t${(i % 9) + 1}.5\t58,000`).join('\r\n');
  await page.locator('#f-lines-0-description').focus();
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', `${text}\r\n`);
    document.getElementById('f-lines-0-description').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, rows);
  await expect(page.getByTestId('grid-notice')).toContainText('Pasted 50 row(s)');
  await expect(page.getByText('Total (50 rows)')).toBeVisible();
  await expect(page.getByTestId('total-amount')).toHaveText('1,53,70,000.00');
  // a bad cell is caught and named by row, then fixed
  await page.locator('#f-lines-2-quantity').fill('12,3456');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(summary).toContainText('Items, row 3: Quantity');
  await page.locator('#f-lines-2-quantity').fill('3.5');
  // submit: saved, recalculated by the server and numbered
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByTestId('toast-success')).toContainText('Submitted as MR/2026-27/0001');
  await expect(page.getByRole('heading', { name: 'MR/2026-27/0001' })).toBeVisible();
  await expect(page.getByTestId('op-header')).toContainText('Awaiting ACCMGR');
  await page.getByRole('tab', { name: 'Lines' }).click();
  await expect(page.getByTestId('total-amount')).toHaveText('1,53,70,000.00');
  await noOverflow(page);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Sample Material Requests' }).click();
  await expect(page.getByText('1 requests, page 1 of 1')).toBeVisible();
  // the same title again for the same project and date is flagged while typing
  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.locator('#f-title').fill('Footing F3 to F7 reinforcement');
  await expect(page.getByTestId('duplicate-warning')).toContainText('MR/2026-27/0001');
  expect(errors).toEqual([]);
});

test('Drafts T-02: a half-filled form survives a crash, is offered back, and is listed and discarded in My Drafts', async ({ page, context, request }, info) => {
  const w = await world(request, pick(info, 'DRFD', 'DRFM'));
  const user = pick(info, 'e2e-draft-d', 'e2e-draft-m');
  await open(page, w.company, 'PM', '/admin/sample-requests?new=1', user, { projectId: w.project.id, siteId: w.site.id });
  await page.locator('#f-title').fill('Shuttering plates for pier P4');
  await page.locator('#f-lines-0-description').fill('Steel plate 600 x 1200');
  await page.locator('#f-lines-0-quantity').click();
  await expect(page.getByText(/Draft saved \d{2}-[A-Z][a-z]{2}-\d{4}/)).toBeVisible({ timeout: 10_000 });
  // the browser crashes: a new page in a new context, same person
  await page.close();
  const again = await context.newPage();
  await open(again, w.company, 'PM', '/admin/sample-requests?new=1', user, { projectId: w.project.id, siteId: w.site.id });
  await expect(again.getByTestId('draft-banner')).toContainText('Shuttering plates for pier P4');
  await again.getByRole('button', { name: 'Resume the draft' }).click();
  await expect(again.locator('#f-title')).toHaveValue('Shuttering plates for pier P4');
  await expect(again.locator('#f-lines-0-description')).toHaveValue('Steel plate 600 x 1200');
  // My Drafts lists it; resume opens the form; discard removes it
  await again.goto('/account/drafts');
  await expect(again.getByRole('heading', { name: 'My Drafts', exact: true })).toBeVisible();
  await expect(again.locator('[data-testid^="draft-"]', { hasText: 'Shuttering plates for pier P4' })).toBeVisible();
  await noOverflow(again);
  again.on('dialog', (d) => d.accept());
  await again.getByRole('button', { name: 'Discard the draft Shuttering plates for pier P4' }).click();
  await expect(again.getByTestId('drafts-notice')).toContainText('1 draft(s) discarded');
  await expect(again.getByRole('heading', { name: 'No drafts' })).toBeVisible();
});

test('T-04 a request completed with the keyboard alone', async ({ page, request }, info) => {
  test.skip(info.project.name === 'mobile', 'keyboard-only entry is a desktop concern; the mobile run covers touch layout');
  const w = await world(request, 'KBDD');
  await open(page, w.company, 'PM', '/admin/sample-requests?new=1', 'e2e-kbd', { projectId: w.project.id, siteId: w.site.id });
  await expect(page.locator('#f-costCentreId')).toHaveValue(/Km 12 camp cost/);
  await page.locator('#f-title').focus();
  await page.keyboard.type('Binding wire for raft');
  await page.keyboard.press('Tab'); // request date (today)
  await page.keyboard.press('Tab'); // calendar button
  await page.keyboard.press('Tab'); // required by
  await page.keyboard.type('15-11-2026');
  await tabTo(page, (el) => el.id === 'f-lines-0-description');
  await page.keyboard.type('Binding wire 18 g');
  await page.keyboard.press('Tab');
  await page.keyboard.type('KG');
  await expect(page.getByRole('option', { name: /KG/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); // clear button of the unit
  await page.keyboard.press('Tab');
  await page.keyboard.type('250');
  await page.keyboard.press('Tab');
  await page.keyboard.type('82.5');
  await page.keyboard.press('Alt+n'); // a second row
  await expect(page.locator('#f-lines-1-description')).toBeFocused();
  await page.keyboard.type('Cover blocks 50 mm');
  await page.keyboard.press('Tab');
  await page.keyboard.type('NOS');
  await expect(page.getByRole('option', { name: /NOS/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('400');
  await page.keyboard.press('Tab');
  await page.keyboard.type('6.25');
  await expect(page.getByTestId('total-amount')).toHaveText('23,125.00');
  await tabTo(page, (el) => el.tagName === 'BUTTON' && el.textContent.trim() === 'Submit');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('toast-success')).toContainText('Submitted as MR/2026-27/0001');
});
