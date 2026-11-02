import { test, expect } from '@playwright/test';
import { setTheme } from './shell-helpers.js';

// Development-header mode (port 3100). Part 03.08: the command palette (Ctrl/Cmd+K, grouped records, pages and actions, keyboard only), the
// Advanced Search page (filters, kinds, paging, saved filters, export) and the Search Administration page (index status, rebuild, analytics).
// Run on a desktop and a phone.
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

async function world(request, code, pm) {
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
  const project = await post('/iam/org/projects', 'PM', company, { code: `${code}-P`, name: 'Ganga Bridge Approach', type: 'ROAD' });
  const site = await post('/iam/org/sites', 'PM', company, { code: `${code}-S1`, name: 'Km 12 camp', projectId: project.id });
  const body = (title) => ({ title, docDate: '2026-10-31', requiredBy: '2026-11-20', projectId: project.id, siteId: site.id, lines: [{ description: 'TMT bar 12 mm', uom: 'MT', quantity: '2.5', unitRate: '58000' }] });
  const first = await post('/ui/sample-requests', 'PM', company, body('Pier cap shuttering'), pm);
  const submitted = await post(`/ui/sample-requests/${first.id}/submit`, 'PM', company, { version: first.version }, pm);
  await post('/ui/sample-requests', 'PM', company, body('Pier cap reinforcement'), pm);
  return { company, project, site, docNo: submitted.docNo };
}
const palette = (page) => page.getByTestId('palette');
/** The index follows events within a second or two; wait until the record can be found. */
async function indexed(request, w, q, pm) {
  await expect.poll(async () => {
    const res = await request.get(`/api/v1/ui/search?q=${encodeURIComponent(q)}&log=0`, { headers: H('PM', w.company, pm) });
    return (await res.json()).data?.total ?? 0;
  }, { timeout: 15_000 }).toBeGreaterThan(0);
}

test('FR-02 FR-03 AC-01 the palette opens with Ctrl+K anywhere, groups records, pages and actions, and works from the keyboard', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const pm = pick(info, 'e2e-pm-sd', 'e2e-pm-sm');
  const w = await world(request, pick(info, 'SRD', 'SRM'), pm);
  await indexed(request, w, 'shuttering', pm);
  const page = await as(browser, info, w.company, 'PM', pm, '/work');
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
  // from a place with a text field in focus: Ctrl+K still opens it
  await page.getByTestId('search-trigger').focus();
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  // nothing typed: actions for this person, favourites and recent
  await expect(palette(page).getByRole('option', { name: /Create a sample material request/ })).toBeVisible();
  // records, grouped, with the typed word marked
  await palette(page).getByRole('combobox').fill('shuttering');
  const hit = palette(page).getByRole('option', { name: /Pier cap shuttering/ });
  await expect(hit).toBeVisible();
  await expect(palette(page).getByText(/Sample material requests \(1\)/)).toBeVisible();
  await expect(hit.locator('mark').first()).toHaveText(/shuttering/i);
  // the document number finds the same record first
  await palette(page).getByRole('combobox').fill(w.docNo);
  await expect(palette(page).getByRole('option').first()).toContainText('Pier cap shuttering');
  // a typing mistake and a piece of a word
  await palette(page).getByRole('combobox').fill('shutring');
  await expect(palette(page).getByRole('option', { name: /Pier cap shuttering/ })).toBeVisible();
  await palette(page).getByRole('combobox').fill('hutter');
  await expect(palette(page).getByRole('option', { name: /Pier cap shuttering/ })).toBeVisible();
  // nothing found: a helpful message, not an error
  await palette(page).getByRole('combobox').fill('qqzzxx');
  await expect(palette(page)).toContainText('Nothing matches');
  // keyboard: arrows then Enter opens the record
  await palette(page).getByRole('combobox').fill('shuttering');
  await expect(hit).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/sample-requests\?open=\d+/);
  await expect(page.getByText('Pier cap shuttering').first()).toBeVisible();
  // the record is now among the recent ones
  await page.keyboard.press('Control+k');
  await expect(palette(page).getByRole('option', { name: /Pier cap shuttering/ })).toBeVisible();
  // actions: ">" lists only actions; one changes the theme, one opens the help
  await palette(page).getByRole('combobox').fill('>dark');
  await palette(page).getByRole('option', { name: /dark theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Control+k');
  await palette(page).getByRole('combobox').fill('>light');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Escape closes
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-05 Advanced Search: filters by kind, project and status, paging, saved filters, export, empty and no-result states', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const pm = pick(info, 'e2e-pm-ad', 'e2e-pm-am');
  const w = await world(request, pick(info, 'SAD', 'SAM'), pm);
  await indexed(request, w, 'shuttering', pm);
  await indexed(request, w, 'reinforcement', pm);
  const page = await as(browser, info, w.company, 'PM', pm, '/search');
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'Advanced Search', level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/Advanced Search/);
  await expect(page.getByText('Type to search')).toBeVisible(); // the empty state before anything is typed
  await page.getByLabel('Search for').fill('pier cap');
  await expect(page.getByTestId('search-result')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: /Sample material requests/ })).toBeVisible();
  // kinds: choose one, then the list is paged
  await page.getByRole('button', { name: /^Sample material requests/ }).click();
  await expect(page).toHaveURL(/types=sample_request/);
  await expect(page.getByText(/2 results, page 1 of 1/)).toBeVisible();
  // status filter
  await page.getByRole('listbox', { name: 'Status' }).selectOption('SUBMITTED');
  await expect(page.getByTestId('search-result')).toHaveCount(1);
  await expect(page.getByTestId('search-result').first()).toContainText('Pier cap shuttering');
  // a project filter that excludes everything shows the no-result state with a way out
  await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ index: 1 });
  await expect(page.getByTestId('search-result')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page.getByTestId('search-result')).toHaveCount(2);
  // saved filters: save, apply after clearing, delete
  await page.getByRole('button', { name: /^Sample material requests/ }).click();
  await page.getByRole('button', { name: 'Save these filters' }).click();
  await page.getByLabel('Name').fill(`Pier requests ${info.project.name}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('search-notice')).toContainText('Saved the filters');
  await page.getByLabel('Search for').fill('');
  await expect(page.getByText('Type to search')).toBeVisible();
  await page.getByText(/^Saved filters/).click();
  await page.getByRole('menuitem', { name: `Pier requests ${info.project.name}` }).click();
  await expect(page.getByLabel('Search for')).toHaveValue('pier cap');
  await expect(page.getByTestId('search-result')).toHaveCount(2);
  // open a record from the results
  await page.getByRole('link', { name: 'Open Pier cap shuttering' }).click();
  await expect(page).toHaveURL(/\/admin\/sample-requests\?open=\d+/);
  await page.goBack();
  await expect(page.getByLabel('Search for')).toHaveValue('pier cap');
  // the export is the list on the screen
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('search-results.csv');
  // nothing found
  await page.getByLabel('Search for').fill('qqzzxx');
  await expect(page.getByText('Nothing found for "qqzzxx"')).toBeVisible();
  await noOverflow(page);
  await setTheme(page, 'dark');
  await expect(page.getByRole('heading', { name: 'Advanced Search', level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test('BR-02 FR-06 Search Administration: index status, a rebuild with a reason, and the searches that found nothing', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const pm = pick(info, 'e2e-pm-xd', 'e2e-pm-xm');
  const w = await world(request, pick(info, 'SXD', 'SXM'), pm);
  await indexed(request, w, 'shuttering', pm);
  // a search that finds nothing, so it shows in the analytics
  await request.get('/api/v1/ui/search?q=zzunfound', { headers: H('PM', w.company, pm) });
  const page = await as(browser, info, w.company, 'ITADM', 'e2e-it', '/admin/search');
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'Search Administration', level: 1 })).toBeVisible();
  const row = page.getByRole('row', { name: /Sample material requests/ });
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Rebuild Sample material requests' }).click();
  await page.getByLabel('Reason').fill('Checking the rebuild after an import');
  await page.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rebuild of Sample material requests queued' })).toBeVisible();
  await expect(page.getByText('Rebuild sample_request').first()).toBeVisible();
  await expect(page.getByText('Succeeded').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('cell', { name: 'zzunfound' }).first()).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
  // the system administrator reads the analytics but cannot rebuild
  const sys = await as(browser, info, w.company, 'SYSADM', 'e2e-sys', '/admin/search');
  await expect(sys.getByRole('heading', { name: 'Search Administration', level: 1 })).toBeVisible();
  await expect(sys.getByRole('button', { name: /^Rebuild/ })).toHaveCount(0);
  // a project manager has no such page
  const denied = await as(browser, info, w.company, 'PM', pm, '/admin/search');
  await expect(denied.getByTestId('no-permission')).toBeVisible();
});
