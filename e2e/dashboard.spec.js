import { test, expect } from '@playwright/test';
import { setTheme } from './shell-helpers.js';

// Development-header mode (port 3100). Part 03.07: My Work and the Requests Overview (live widgets, drill-down to the matching list, filters,
// refresh, chart table and exports), a person's own layout that follows them to another device, and a role default that an administrator asks
// for and another approves, which a new person of the role then sees. Run on a desktop and a phone.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
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

/** A company with a project and site, one submitted and one draft request raised by a project manager. */
async function world(request, code, pm = 'e2e-pm') {
  const post = async (path, roles, company, data, user = 'e2e-setup') => {
    const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const current = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup') });
  const version = current.ok() ? (await current.json()).data?.version : undefined;
  expect((await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } })).status()).toBe(200);
  for (const [path, data] of [['/core/financial-years', { startDate: '2026-04-01' }], ['/core/number-series', { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' }]]) {
    const res = await request.post(`/api/v1${path}`, { headers: H('SYSADM', company, 'e2e-setup'), data });
    expect([201, 409], `${path}: ${await res.text()}`).toContain(res.status());
  }
  const project = await post('/iam/org/projects', 'PM', company, { code: `${code}-P`, name: 'NH-48 Widening', type: 'ROAD' });
  const site = await post('/iam/org/sites', 'PM', company, { code: `${code}-S1`, name: 'Km 12 camp', projectId: project.id });
  const body = (title) => ({ title, docDate: '2026-10-31', requiredBy: '2026-11-20', projectId: project.id, siteId: site.id, lines: [{ description: 'TMT bar 12 mm', uom: 'MT', quantity: '2.5', unitRate: '58000' }] });
  const first = await post('/ui/sample-requests', 'PM', company, body('Footing F3 reinforcement'), pm);
  await post(`/ui/sample-requests/${first.id}/submit`, 'PM', company, { version: first.version }, pm);
  await post('/ui/sample-requests', 'PM', company, body('Kerb stone samples'), pm);
  return { company, project, site };
}
const filters = (page) => page.getByRole('form', { name: 'Dashboard filters' });
const widget = (page, code) => page.getByTestId(`widget-${code}`);
const kpi = (page, code) => widget(page, code).getByTestId('kpi-value');
const totals = (page) => page.getByTestId('list-totals').first();

test('FR-01 FR-05 FR-06 BR-02 AC-01 T-02 My Work is live, empty where nothing exists yet, and every figure opens the list with the same filters and count', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const pm = pick(info, 'e2e-pm-d', 'e2e-pm-m');
  const w = await world(request, pick(info, 'DSAD', 'DSAM'), pm);
  const page = await as(browser, info, w.company, 'PM', pm, '/work');
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
  await expect(page.getByTestId('dashboard')).toHaveAttribute('data-source', 'system');
  // figures come from the register, not from the page
  await expect(kpi(page, 'requests.submitted')).toHaveText('1');
  await expect(kpi(page, 'requests.mine_open')).toHaveText('2');
  await expect(kpi(page, 'drafts.mine')).toBeVisible();
  // the services that arrive in later parts say so (AC-01)
  await expect(widget(page, 'tasks.mine')).toContainText('No tasks yet');
  await expect(widget(page, 'approvals.list')).toContainText('Nothing is waiting for you');
  await expect(widget(page, 'approvals.timeliness')).toHaveCount(0); // a project manager has no right to the timeliness figure, and the page says so
  await expect(page.getByTestId('dash-omitted')).toContainText('not shown because your role');
  // each widget says when it was read (FR-06)
  await expect(widget(page, 'requests.submitted').getByTestId('widget-updated')).toContainText('Updated');
  const reread = page.waitForResponse((r) => r.url().includes('/widgets/requests.submitted/data') && r.status() === 200);
  await page.getByRole('button', { name: 'Refresh Submitted requests' }).click();
  await reread;
  // the donut: a slice opens the list of that status, and the list says the same number
  await widget(page, 'requests.by_status').getByRole('link', { name: /^Draft: 1/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/sample-requests\?.*filter%5Bstatus%5D=DRAFT|\/admin\/sample-requests\?.*filter\[status\]=DRAFT/);
  await expect(totals(page)).toContainText('Total of 1 rows');
  await page.goBack();
  await expect(kpi(page, 'requests.submitted')).toHaveText('1');
  // the KPI: the submitted count opens the submitted list with the same period, and the count matches
  await kpi(page, 'requests.submitted').click();
  await expect(page).toHaveURL(/filter(%5B|\[)status(%5D|\])=SUBMITTED/);
  await expect(page).toHaveURL(/docDate/);
  await expect(totals(page)).toContainText('Total of 1 rows');
  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-03 FR-04 T-03 a person arranges their own dashboard by buttons or dragging; it is kept on the server and follows them to another device; reset returns the default', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const w = await world(request, pick(info, 'DSBD', 'DSBM'));
  const user = pick(info, 'e2e-pm-b-d', 'e2e-pm-b-m');
  const page = await as(browser, info, w.company, 'PM', user, '/work');
  const errors = watch(page);
  await expect(page.getByTestId('dashboard-grid')).toBeVisible();
  const order = () => page.locator('[data-testid="dashboard-grid"] article').evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')));
  const before = await order();
  expect(before[0]).toBe('approvals.waiting');
  // the global filters narrow every widget: last financial year has none of this year's requests
  await filters(page).getByLabel('Period').selectOption('last-fy');
  await expect(kpi(page, 'requests.submitted')).toHaveText('0');
  await filters(page).getByLabel('Period').selectOption('this-fy');
  await expect(kpi(page, 'requests.submitted')).toHaveText('1');
  await filters(page).getByLabel('Project').selectOption({ label: `${w.project.code} NH-48 Widening` });
  await expect(kpi(page, 'requests.submitted')).toHaveText('1');
  await filters(page).getByLabel('Project').selectOption('');
  // customise: move one place later by its button, remove one, add a notice
  await page.getByTestId('customise').click();
  await expect(page.getByTestId('save-layout')).toBeDisabled();
  await page.getByRole('button', { name: 'Move later: Approvals waiting for me' }).click();
  expect((await order())[1]).toBe('approvals.waiting');
  if (info.project.name === 'desktop') {
    // drag the third place onto the first
    const third = page.locator('[data-testid="dashboard-grid"] article').nth(2);
    const was = (await order())[2];
    await third.locator('.wd-title').dragTo(page.locator('[data-testid="dashboard-grid"] article').first());
    expect((await order())[0]).toBe(was);
  }
  await page.getByRole('button', { name: 'Remove: Quick actions' }).click();
  await page.getByTestId('add-widget').selectOption({ label: 'Notice' });
  await expect(page.getByTestId('save-layout')).toBeDisabled(); // the notice has no text yet
  await page.locator('article[data-widget="notice.text"] textarea').fill('Cube test results are due on Friday.');
  await expect(page.getByTestId('save-layout')).toBeEnabled();
  await page.getByTestId('save-layout').click();
  await expect(page.getByTestId('dash-message')).toContainText('Your layout is saved');
  await expect(page.getByTestId('dashboard')).toHaveAttribute('data-source', 'personal');
  await expect(widget(page, 'actions.quick')).toHaveCount(0);
  await expect(widget(page, 'notice.text')).toContainText('Cube test results are due on Friday.');
  const saved = await order();
  // another device: a fresh browser context with the same sign-in sees the same arrangement
  const other = await as(browser, info, w.company, 'PM', user, '/work');
  await expect(other.getByTestId('dashboard')).toHaveAttribute('data-source', 'personal');
  expect(await other.locator('[data-testid="dashboard-grid"] article').evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')))).toEqual(saved);
  await expect(widget(other, 'notice.text')).toContainText('Cube test results');
  // reset gives the personal copy up
  other.on('dialog', (d) => d.accept());
  await other.getByRole('button', { name: 'Reset to default' }).click();
  await expect(other.getByTestId('dashboard')).toHaveAttribute('data-source', 'system');
  await expect(widget(other, 'actions.quick')).toBeVisible();
  await expect(widget(other, 'notice.text')).toHaveCount(0);
  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-08 the Requests Overview: charts have a tooltip, a legend and the same figures as a table, export to CSV and PNG, drill to the list, and follow the dark theme', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const w = await world(request, pick(info, 'DSDD', 'DSDM'));
  const page = await as(browser, info, w.company, 'PM', pick(info, 'e2e-pm-c-d', 'e2e-pm-c-m'), '/admin/sample-requests/overview');
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'Requests Overview', level: 1 })).toBeVisible();
  const bars = widget(page, 'requests.by_project');
  await expect(bars.locator('svg.ch-svg')).toBeVisible();
  // the table fallback has the figures the chart draws
  // with ff.ui.p16605 the chart switches to a table ("Show as table") and back; before it, the table was under "View as table"
  const toTable = bars.getByTestId('chart-show-table');
  if (await toTable.count()) await toTable.click(); else await bars.getByText('View as table').click();
  await expect(bars.getByRole('table')).toContainText(`${w.project.code}`);
  await expect(bars.getByRole('table')).toContainText('2');
  if (await toTable.count()) { await bars.getByRole('button', { name: 'Show as chart' }).click(); await expect(bars.locator('svg.ch-svg')).toBeVisible(); }
  // a tooltip on hover (desktop) names the value
  if (info.project.name === 'desktop') {
    await bars.locator('g.ch-mark').first().hover();
    await expect(page.locator('.ch-tip')).toContainText(`${w.project.code}, Requests: 2`);
  }
  // exports
  const csv = page.waitForEvent('download');
  await bars.getByRole('button', { name: 'CSV' }).click();
  expect((await csv).suggestedFilename()).toBe('requests-by_project.csv');
  const png = page.waitForEvent('download');
  await bars.getByRole('button', { name: 'PNG' }).click();
  expect((await png).suggestedFilename()).toBe('requests-by_project.png');
  // the heat map, the S-curve and the Gantt each draw from the register
  await expect(widget(page, 'requests.heatmap').locator('svg.ch-svg')).toBeVisible();
  await expect(widget(page, 'requests.scurve').locator('svg.ch-svg')).toBeVisible();
  await expect(widget(page, 'requests.gantt').locator('svg.ch-svg')).toBeVisible();
  // the bar opens the list of that project's requests
  await bars.locator('g.ch-mark.is-link').first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/projectCode/);
  await expect(totals(page)).toContainText('Total of 2 rows');
  await page.goBack();
  // dark theme: charts keep their tokens, nothing overflows
  await setTheme(page, 'dark');
  await expect(bars.locator('svg.ch-svg')).toBeVisible();
  const fill = await bars.locator('g.ch-mark rect').first().evaluate((e) => getComputedStyle(e).fill);
  expect(fill).not.toBe('none');
  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-03 AC-02 AC-05 the designer: an administrator asks for the default of a role, another approves, and a new person of that role sees it; changes are recorded', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const w = await world(request, pick(info, 'DSED', 'DSEM'));
  const a = await as(browser, info, w.company, 'SYSADM', pick(info, 'e2e-adm-a-d', 'e2e-adm-a-m'), '/admin/dashboards');
  const errors = watch(a);
  await expect(a.getByRole('heading', { name: 'Dashboard Designer', level: 1 })).toBeVisible();
  await a.getByTestId('dd-role').selectOption('SE');
  await expect(a.getByTestId('dd-state')).toContainText('no default of its own');
  await expect(a.getByTestId('dd-submit')).toBeDisabled();
  await a.getByRole('button', { name: 'Remove: Approvals decided in time' }).click();
  await a.getByTestId('dd-add').selectOption({ label: 'Notice' });
  await a.locator('article[data-widget="notice.text"] textarea').fill('Site safety briefing at 8 every morning.');
  await a.getByTestId('dd-reason').fill('Site engineers need the safety notice on their home page.');
  await a.getByTestId('dd-submit').click();
  await expect(a.getByTestId('dd-message')).toContainText('waiting for another administrator');
  await expect(a.getByTestId('dd-pending-item')).toHaveCount(1);
  await expect(a.getByTestId('dd-pending-item')).toContainText('You raised it');
  await expect(a.getByRole('button', { name: 'Approve' })).toHaveCount(0); // maker-checker: not the requester
  // a second administrator approves
  const b = await as(browser, info, w.company, 'SYSADM', pick(info, 'e2e-adm-b-d', 'e2e-adm-b-m'), '/admin/dashboards');
  await b.getByTestId('dd-role').selectOption('SE');
  await expect(b.getByTestId('dd-pending-item')).toContainText('Set the default of SE');
  await b.getByRole('button', { name: 'Approve' }).click();
  await expect(b.getByTestId('dd-pending-item')).toHaveCount(0);
  await expect(b.getByTestId('dd-state')).toContainText('SE has its own default, version 1');
  await expect(b.getByText('Site engineers need the safety notice').first()).toBeVisible(); // the reason is on the history of the role
  // a person of the role who has never arranged their own sees it (AC-02), a project manager still sees the standard layout
  const se = await as(browser, info, w.company, 'SE', pick(info, 'e2e-se-new-d', 'e2e-se-new-m'), '/work');
  await expect(se.getByTestId('dashboard')).toHaveAttribute('data-source', 'role');
  await expect(widget(se, 'notice.text')).toContainText('Site safety briefing at 8 every morning.');
  await expect(widget(se, 'approvals.timeliness')).toHaveCount(0);
  const pm = await as(browser, info, w.company, 'PM', pick(info, 'e2e-pm-e-d', 'e2e-pm-e-m'), '/work');
  await expect(pm.getByTestId('dashboard')).toHaveAttribute('data-source', 'system');
  // a person without the right cannot open the designer
  const denied = await as(browser, info, w.company, 'PM', pick(info, 'e2e-pm-f-d', 'e2e-pm-f-m'), '/admin/dashboards');
  await expect(denied.getByRole('heading', { name: 'Dashboard Designer', level: 1 })).toHaveCount(0);
  if (info.project.name === 'mobile') await noOverflow(a);
  expect(errors).toEqual([]);
});
