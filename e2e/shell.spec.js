import { test, expect } from '@playwright/test';
import { menu, registryMenu, userMenu } from './shell-helpers.js';

// Development-header mode (port 3100). The application shell (part 03.05): the menu per role, the route guard, the working context, the
// launchpad with favourites and recent records, the bell, the keyboard, and the navigation registry's change by request and approval.
// Each viewport works in its own company.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
/** No horizontal scroll; when there is, the elements that stick out are named in the failure. */
const noOverflow = async (page) => {
  const stick = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= document.documentElement.clientWidth) return [];
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && getComputedStyle(e).visibility !== 'hidden'; }).slice(0, 6).map((e) => `${e.tagName}.${e.className}:${Math.round(e.getBoundingClientRect().right)}`);
  });
  expect(stick).toEqual([]);
};
const opened = [];
test.afterEach(async () => { while (opened.length) await opened.pop().close(); });
/** A person with their own browser storage (a page of the shared context would share the development identity). */
const as = async (browser, info, company, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  opened.push(context);
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
  return page;
};

async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => {
    const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const current = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup') });
  const version = current.ok() ? (await current.json()).data?.version : undefined;
  const put = await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } });
  expect(put.status(), await put.text()).toBe(200);
  // the company may take an id an older spec already used with fixed ids: a financial year or series that exists is fine
  for (const [path, data] of [['/core/financial-years', { startDate: '2026-04-01' }], ['/core/number-series', { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' }]]) {
    const res = await request.post(`/api/v1${path}`, { headers: H('SYSADM', company, 'e2e-setup'), data });
    expect([201, 409], `${path}: ${await res.text()}`).toContain(res.status());
  }
  const p1 = await post('/iam/org/projects', 'PM', company, { code: `${code}-A`, name: 'NH-48 Widening', type: 'ROAD' });
  const s1 = await post('/iam/org/sites', 'PM', company, { code: `${code}-A1`, name: 'Km 12 camp', projectId: p1.id });
  const p2 = await post('/iam/org/projects', 'PM', company, { code: `${code}-B`, name: 'Ring Road Phase 2', type: 'ROAD' });
  const s2 = await post('/iam/org/sites', 'PM', company, { code: `${code}-B1`, name: 'Km 3 yard', projectId: p2.id });
  const make = async (title, project, site, { submit = false } = {}) => {
    const r = await post('/ui/sample-requests', 'PM', company, { title, docDate: '2026-10-31', requiredBy: '2026-11-20', projectId: project.id, siteId: site.id, lines: [{ description: 'TMT bar 12 mm', uom: 'MT', quantity: '2.5', unitRate: '58000' }] }, 'e2e-pm');
    return submit ? post(`/ui/sample-requests/${r.id}/submit`, 'PM', company, { version: r.version }, 'e2e-pm') : r;
  };
  return { company, p1, s1, p2, s2, make, code };
}

test('T-01 FR-01 FR-02 three roles see exactly the entries they may open; the technical console is apart from the business groups', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const w = await world(request, pick(info, 'SHMD', 'SHMM'));
  const errors = [];
  const pm = await as(browser, info, w.company, 'PM', pick(info, 'e2e-shell-pm-d', 'e2e-shell-pm-m'), '/home');
  const sys = await as(browser, info, w.company, 'SYSADM', pick(info, 'e2e-shell-sys-d', 'e2e-shell-sys-m'), '/home');
  const acc = await as(browser, info, w.company, 'ACCMGR', pick(info, 'e2e-shell-acc-d', 'e2e-shell-acc-m'), '/home');
  for (const p of [pm, sys, acc]) errors.push(...watch(p));
  // a project manager: Home, the procurement register, own account pages; no administration, no console
  const pmNav = await menu(pm);
  await expect(pmNav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(pmNav.getByRole('link', { name: 'Sample Material Requests' })).toBeVisible();
  await expect(pmNav.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
  await expect(pmNav.getByRole('link', { name: 'Navigation Registry' })).toHaveCount(0);
  await expect(pmNav.getByRole('region', { name: 'Technical Console' })).toHaveCount(0);
  await expect(pmNav.getByRole('region', { name: 'Procurement' })).toBeVisible();
  // a group is drawn only when the registry gives this role a page in it (read from the registry seed and the role template, so a part that adds a page cannot break this)
  const pmMenu = registryMenu('PM'); const drawn = await pmNav.getByRole('region').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).filter(Boolean));
  for (const g of drawn) expect(pmMenu.groups.has(g) || ['Home', 'My Work', 'Account'].includes(g), `the group "${g}" is drawn for a PM but the registry gives the role no page in it`).toBe(true);
  for (const name of ['Users', 'Navigation Registry']) expect(pmMenu.pages.has(name), `the registry must not give a PM "${name}"`).toBe(false);
  // the accounts manager: approvals are in My Work; still no administration
  const accNav = await menu(acc);
  await expect(accNav.getByRole('region', { name: 'My Work' }).getByRole('link', { name: 'Approvals', exact: true })).toBeVisible();
  await expect(accNav.getByRole('link', { name: 'Navigation Registry' })).toHaveCount(0);
  // the system administrator: administration and the console, which is its own section
  const sysNav = await menu(sys);
  await expect(sysNav.getByRole('region', { name: 'Administration' }).getByRole('link', { name: 'Users', exact: true })).toBeVisible();
  await expect(sysNav.getByRole('region', { name: 'Administration' }).getByRole('link', { name: 'Navigation Registry' })).toBeVisible();
  const consoleNav = sysNav.getByRole('region', { name: 'Technical Console' });
  for (const name of ['Feature Flags', 'Operations', 'About', 'Data Health', 'Design System']) await expect(consoleNav.getByRole('link', { name, exact: true })).toBeVisible();
  for (const name of ['About', 'Data Health', 'Feature Flags']) await expect(sysNav.getByRole('region', { name: 'Administration' }).getByRole('link', { name, exact: true })).toHaveCount(0);
  await expect(sysNav.getByRole('region', { name: 'Account' }).getByRole('link', { name: 'My Profile' })).toBeVisible();
  if (info.project.name === 'mobile') await noOverflow(sys);
  expect(errors).toEqual([]);
});

test('T-02 FR-08 a page the role may not open shows the no-permission state, and the API behind it answers 403', async ({ browser, request }, info) => {
  const w = await world(request, pick(info, 'SHGD', 'SHGM'));
  const user = pick(info, 'e2e-guard-d', 'e2e-guard-m');
  const page = await as(browser, info, w.company, 'PM', user, '/admin/users');
  const errors = watch(page);
  await expect(page.getByTestId('no-permission')).toBeVisible();
  await expect(page.getByTestId('no-permission')).toContainText('iam.user.view');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toHaveCount(0);
  expect((await request.get('/api/v1/iam/users', { headers: H('PM', w.company, user) })).status()).toBe(403);
  // the breadcrumb and the menu still work from there
  await (await menu(page)).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(page).toHaveTitle('Home - ERP');
  expect(errors).toEqual([]);
});

test('T-03 FR-03 the working context filters the list, fills the form, is remembered per person, and asks before it costs unsaved work', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const w = await world(request, pick(info, 'SHCD', 'SHCM'));
  await w.make('Footing in A', w.p1, w.s1);
  await w.make('Pier cap in B', w.p2, w.s2);
  const user = pick(info, 'e2e-ctx-d', 'e2e-ctx-m');
  const page = await as(browser, info, w.company, 'PM', user, '/admin/sample-requests');
  const errors = watch(page);
  await expect(page.getByText('2 requests, page 1 of 1')).toBeVisible();
  // choose project A in the switcher (search first): the list narrows and says so
  await page.getByTestId('context-button').click();
  const panel = page.getByRole('group', { name: 'Working context' });
  await panel.getByLabel('Find a project or site').fill(`${w.code}-A`);
  await expect(panel.getByRole('option', { name: new RegExp(`${w.code}-B`) })).toHaveCount(0);
  await panel.getByRole('option', { name: new RegExp(`^${w.code}-A `) }).click();
  await expect(page.getByTestId('list-context')).toContainText(`${w.code}-A`);
  await expect(page.getByText('1 requests, page 1 of 1')).toBeVisible();
  await expect(page.getByText('Footing in A').first()).toBeVisible();
  await expect(page.getByText('Pier cap in B')).toHaveCount(0);
  // a new form starts with that project
  await page.getByRole('button', { name: 'New request' }).first().click();
  await expect(page.locator('#f-projectId')).toHaveValue(/NH-48 Widening/);
  // BR-02: with unsaved changes, changing the context asks first; declining keeps both the form and the context
  await page.locator('#f-title').fill('Not saved yet');
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await page.getByTestId('context-button').click();
  await page.getByRole('group', { name: 'Working context' }).getByRole('option', { name: 'All projects' }).click();
  await expect.poll(() => asked).toMatch(/not saved/i);
  await expect(page.locator('#f-title')).toHaveValue('Not saved yet');
  await expect(page.getByTestId('context-button')).toContainText(`${w.code}-A`);
  // accepting it moves on: the form is left, the list is whole again
  page.once('dialog', (d) => d.accept());
  await page.getByRole('group', { name: 'Working context' }).getByRole('option', { name: 'All projects' }).click();
  await expect(page.getByTestId('context-button')).toContainText('All projects');
  // the choice is kept on the server for the person: forget this browser's copy and it comes back
  await page.getByTestId('context-button').click();
  await page.getByRole('group', { name: 'Working context' }).getByRole('option', { name: new RegExp(`^${w.code}-B `) }).click();
  await expect(page.getByTestId('context-button')).toContainText(`${w.code}-B`);
  await page.evaluate(() => localStorage.removeItem('erp.context'));
  await page.goto('/admin/sample-requests');
  await expect(page.getByTestId('context-button')).toContainText(`${w.code}-B`);
  await expect(page.getByText('Pier cap in B').first()).toBeVisible();
  // another person starts with no context, and a site narrows further
  const other = await as(browser, info, w.company, 'PM', `${user}-2`, '/admin/sample-requests');
  await expect(other.getByTestId('context-button')).toContainText('All projects');
  await other.getByTestId('context-button').click();
  await other.getByRole('group', { name: 'Working context' }).getByRole('option', { name: new RegExp(`${w.code}-A1`) }).click();
  await expect(other.getByTestId('context-button')).toContainText(`${w.code}-A / ${w.code}-A1`);
  await expect(other.getByText('1 requests, page 1 of 1')).toBeVisible();
  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('FR-06 the launchpad: what is waiting, tiles for the role, favourites in the person\'s order, recent records, and the bell for the approver', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const w = await world(request, pick(info, 'SHLD', 'SHLM'));
  const rec = await w.make('Slab S2 steel', w.p1, w.s1, { submit: true });
  const accUser = pick(info, 'e2e-lp-acc-d', 'e2e-lp-acc-m');
  const acc = await as(browser, info, w.company, 'ACCMGR', accUser, '/home');
  const errors = watch(acc);
  // the approver: one request waiting, on the card and on the bell
  await expect(acc.getByTestId('pending-approvals')).toHaveAttribute('data-count', '1');
  // the bell is the notification centre's (part 04.06): it counts what the person was told, and this request (of the earlier approval service) tells nobody
  await expect(acc.getByRole('button', { name: 'No unread notifications' })).toBeVisible();
  await expect(acc.getByTestId('tile-admin-approvals')).toBeVisible();
  await expect(acc.getByTestId('tile-admin-users')).toHaveCount(0);
  await expect(acc.getByTestId('no-favourites')).toBeVisible();
  await expect(acc.getByTestId('no-recent')).toBeVisible();
  // the requester: opens the record (it becomes a recent record) and pins the record and a page
  const pmUser = pick(info, 'e2e-lp-pm-d', 'e2e-lp-pm-m');
  const pm = await as(browser, info, w.company, 'PM', pmUser, `/admin/sample-requests?open=${rec.id}`);
  errors.push(...watch(pm));
  await expect(pm.getByRole('heading', { name: rec.docNo })).toBeVisible();
  await pm.getByTestId('record-favourite').click();
  await expect(pm.getByTestId('record-favourite')).toHaveAttribute('aria-pressed', 'true');
  await (await menu(pm)).getByRole('link', { name: 'Sample Material Requests' }).click();
  await expect(pm.getByRole('heading', { name: 'Sample Material Requests', exact: true })).toBeVisible();
  await pm.getByTestId('favourite-toggle').click();
  await expect(pm.getByTestId('favourite-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(pm.getByTestId('toast-success').filter({ hasText: 'added to your favourites' })).toBeVisible();
  await (await menu(pm)).getByRole('link', { name: 'Home', exact: true }).click();
  const favs = pm.getByRole('list', { name: 'Favourites' });
  await expect(favs.getByRole('link')).toHaveText([rec.docNo, 'Sample Material Requests']);
  await expect(pm.getByRole('list', { name: 'Recent records' }).getByRole('link', { name: rec.docNo })).toBeVisible();
  // the person sets the order, and removes one
  await favs.getByRole('button', { name: `Move ${rec.docNo} down` }).click();
  await expect(favs.getByRole('link')).toHaveText(['Sample Material Requests', rec.docNo]);
  await favs.getByRole('button', { name: 'Remove Sample Material Requests from favourites' }).click();
  await expect(favs.getByRole('link')).toHaveText([rec.docNo]);
  // the record is opened from the favourite
  await favs.getByRole('link', { name: rec.docNo }).click();
  await expect(pm.getByRole('heading', { name: rec.docNo })).toBeVisible();
  // the requester has nothing to decide
  await expect(pm.getByTestId('bell-count')).toHaveCount(0);
  if (info.project.name === 'mobile') await noOverflow(pm);
  expect(errors).toEqual([]);
});

test('FR-04 FR-07 header and keyboard: search or go to, quick create, g-shortcuts, the shortcut list, language and the collapsible menu', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const w = await world(request, pick(info, 'SHKD', 'SHKM'));
  const page = await as(browser, info, w.company, 'PM', pick(info, 'e2e-key-d', 'e2e-key-m'), '/home');
  const errors = watch(page);
  const desktop = info.project.name === 'desktop';
  // the skip link is the first thing a keyboard reaches
  await expect(page.getByTestId('search-trigger')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  // search or go to: type, arrow, enter
  await page.getByTestId('search-trigger').click();
  const palette = page.getByTestId('palette');
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox').fill('indent');
  await expect(palette.getByRole('option', { name: /Sample Material Requests/ })).toBeVisible();
  await palette.getByRole('option', { name: /Sample Material Requests/ }).click(); // later parts add pages that also match, so the entry is chosen by name, not by its place in the list
  await expect(page.getByRole('heading', { name: 'Sample Material Requests', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Sample Material Requests/);
  await expect(page.getByRole('navigation', { name: 'You are here' }).getByRole('listitem')).toHaveText(['Home', 'Procurement', 'Sample Material Requests']);
  if (desktop) {
    // Ctrl+K from anywhere, then Escape; g then h goes Home; ? lists the shortcuts
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcut-help')).toContainText('Search or go to a page');
    await expect(page.getByTestId('shortcut-help')).toContainText('Sample Material Requests');
    await page.getByRole('button', { name: 'Close' }).click();
    // typing in a field never triggers a shortcut
    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await expect(page.getByRole('heading', { name: 'Sample Material Requests', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New request' }).first().click();
    await page.locator('#f-title').fill('ghm');
    await expect(page.locator('#f-title')).toHaveValue('ghm');
  }
  // quick create offers what the role may create
  await page.goto('/home');
  await page.getByTestId('quick-create').click();
  await page.getByRole('menuitem', { name: 'New sample material request' }).click();
  await expect(page.getByRole('heading', { name: 'New sample material request' })).toBeVisible();
  // language: the group names follow
  await (await userMenu(page)).getByLabel('Language').selectOption('hi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect((await menu(page)).getByRole('region', { name: 'खरीद' })).toBeVisible();
  await (await userMenu(page)).getByLabel('भाषा').selectOption('en'); // the label is Hindi now
  await expect((await menu(page)).getByRole('region', { name: 'Procurement' })).toBeVisible();
  if (desktop) {
    // the menu collapses to icons and comes back
    await page.getByRole('button', { name: 'Collapse menu' }).click();
    const width = await page.getByRole('navigation', { name: 'Main' }).evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeLessThan(80);
    await page.getByRole('button', { name: 'Expand menu' }).click();
    expect(await page.getByRole('navigation', { name: 'Main' }).evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(200);
  } else {
    await noOverflow(page);
  }
  expect(errors).toEqual([]);
});

test('FR-07 the phone menu: opening it moves focus into it, Escape closes it and gives focus back, a link opens its page and closes the menu', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'desktop', 'the menu is a drawer on a phone only');
  test.setTimeout(90_000);
  const w = await world(request, 'SHDM');
  const page = await as(browser, info, w.company, 'PM', 'e2e-drawer-m', '/home');
  const errors = watch(page);
  const nav = page.locator('#sh-nav');
  await nav.waitFor({ state: 'attached' });
  const burger = page.locator('.sh-burger, [data-testid="bottom-more"]').filter({ visible: true }).first(); // a touch phone opens the menu from the bottom bar
  await expect(burger).toBeVisible();
  await burger.click();
  await expect(nav).toHaveAttribute('data-open', 'true');
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('#sh-nav')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(nav).not.toHaveAttribute('data-open', 'true');
  await expect(burger).toBeFocused();
  await burger.click();
  await nav.getByRole('link', { name: 'Sample Material Requests' }).click();
  await expect(page).toHaveURL(/\/admin\/sample-requests$/);
  await expect(nav).not.toHaveAttribute('data-open', 'true');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('AC-05 FR-01 FR-08 FR-09 the registry is changed by request and approval: a page may need a project; history, export and import follow', async ({ browser, request }, info) => {
  test.skip(info.project.name === 'mobile', 'the registry is shared by both viewports, so it is changed once');
  test.setTimeout(180_000);
  const w = await world(request, 'SHRD');
  const errors = [];
  const sys1 = await as(browser, info, w.company, 'SYSADM', 'e2e-reg-sys1', '/admin/navigation');
  errors.push(...watch(sys1));
  const restore = async () => {
    const sys = (user) => H('SYSADM', w.company, user);
    const list = await (await request.get('/api/v1/ui/navigation/registry', { headers: sys('e2e-reg-sys1') })).json();
    const bills = list.data.entries.find((e) => e.code === 'admin-sample-bills');
    if (bills.label === 'Sample Bills' && !bills.requiresContext) return;
    const r = await request.post('/api/v1/ui/navigation/changes', { headers: sys('e2e-reg-sys1'), data: { code: 'admin-sample-bills', changes: { label: 'Sample Bills', requiresContext: null }, reason: 'Restore after the shell test' } });
    if (r.status() === 201) await request.post(`/api/v1/core/change-requests/${(await r.json()).data.id}/act`, { headers: sys('e2e-reg-sys2'), data: { action: 'approve', comment: 'restored' } });
  };
  try {
    await expect(sys1.getByRole('heading', { name: 'Navigation Registry', exact: true })).toBeVisible();
    await sys1.getByRole('searchbox', { name: 'Find an entry' }).fill('Sample Bills');
    await sys1.getByRole('button', { name: 'Change Sample Bills' }).click();
    const dialog = sys1.getByRole('dialog', { name: 'Change Sample Bills' });
    await dialog.getByLabel('Label', { exact: true }).fill('Billing samples');
    await dialog.getByLabel('Needs a working context').selectOption('project');
    await dialog.getByLabel(/^Reason/).fill('Billing is always for one project');
    await dialog.getByRole('button', { name: 'Request change' }).click();
    await expect(sys1.getByTestId('registry-notice')).toContainText('Another system administrator must approve');
    await expect(sys1.getByRole('table', { name: 'Changes waiting for approval' })).toContainText('Billing samples');
    // the requester cannot approve; nothing has changed in anybody's menu
    await expect(sys1.getByRole('table', { name: 'Changes waiting for approval' })).toContainText('Waiting for another administrator');
    await expect(sys1.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    const pm = await as(browser, info, w.company, 'PM', 'e2e-reg-pm', '/admin/sample-bills');
    await expect(pm.getByRole('heading', { name: 'Sample Bills', level: 1 })).toBeVisible();
    // a second administrator approves
    const sys2 = await as(browser, info, w.company, 'SYSADM', 'e2e-reg-sys2', '/admin/navigation');
    await sys2.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(sys2.getByText('No changes are waiting for approval.')).toBeVisible();
    // the menu now says Billing samples, and the page needs a project before it opens (FR-08)
    await pm.reload();
    await expect(pm.getByTestId('context-needed')).toContainText('Choose a project first');
    await expect((await menu(pm)).getByRole('link', { name: 'Billing samples' })).toBeVisible();
    await pm.getByRole('button', { name: 'Choose a project' }).click();
    await pm.getByRole('group', { name: 'Working context' }).getByRole('option', { name: new RegExp(`^${w.code}-A `) }).click();
    await expect(pm.getByRole('heading', { name: 'Sample Bills', level: 1 })).toBeVisible();
    // history shows who changed what, and why
    await sys2.reload();
    await sys2.getByRole('searchbox', { name: 'Find an entry' }).fill('Billing samples');
    await sys2.getByRole('button', { name: 'History of Billing samples' }).click();
    const history = sys2.getByRole('dialog', { name: 'Change history' });
    await expect(history).toContainText('e2e-reg-sys2');
    await expect(history).toContainText('Billing is always for one project');
    await expect(history).toContainText('label');
    await expect(history).toContainText('Sample Bills → Billing samples');
    await history.getByRole('button', { name: 'Close' }).click();
    // export, and import: nothing is written, differences become requests
    const download = sys2.waitForEvent('download');
    await sys2.getByRole('button', { name: 'Export settings' }).click();
    expect((await download).suggestedFilename()).toBe('navigation-registry.json');
    await sys2.getByLabel('Reason for the import').fill('Trying the import');
    await sys2.locator('#registry-import').setInputFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ entries: [{ code: 'admin-holidays', label: 'Holidays' }, { code: 'admin-numbering', label: 'Number series' }, { code: 'ghost', label: 'x' }] })) });
    await expect(sys2.getByTestId('import-result')).toContainText('1 change request(s) raised, 1 entries unchanged, 1 not accepted');
    await expect(sys2.getByTestId('import-result')).toContainText('ghost');
    await expect(sys2.getByRole('table', { name: 'Changes waiting for approval' })).toContainText('Number series');
    // a person without the right sees the no-permission state on the registry page
    const emp = await as(browser, info, w.company, 'PM', 'e2e-reg-pm2', '/admin/navigation');
    await expect(emp.getByTestId('no-permission')).toContainText('ui.nav.manage');
    expect(errors).toEqual([]);
  } finally {
    await restore();
  }
});

test('PACK-07 the context switcher by keyboard alone: type and Enter, arrows over the recent contexts, Escape gives focus back; recent contexts follow the person', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const w = await world(request, pick(info, 'SHKD', 'SHKM'));
  const flag = await request.patch('/api/v1/core/feature-flags/ff.ui.pack07', { headers: H('SYSADM', w.company, 'e2e-setup'), data: { scope: { level: 'company', companyId: w.company }, enabled: true, reason: 'e2e: PACK-07 switcher' } });
  expect(flag.status(), await flag.text()).toBe(200);
  const user = pick(info, 'e2e-kbd-d', 'e2e-kbd-m');
  const page = await as(browser, info, w.company, 'PM', user, '/admin/sample-requests');
  const errors = watch(page);
  const button = page.getByTestId('context-button');
  await expect(button).toContainText('All projects');
  // open with the keyboard; the search box has focus; type a code and press Enter: the first match is chosen and focus is back on the button
  await button.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Find a project or site')).toBeFocused();
  await page.keyboard.type(`${w.code}-B`); await page.keyboard.press('Enter');
  await expect(button).toContainText(`${w.code}-B`);
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter'); await page.keyboard.type(`${w.code}-A`); await page.keyboard.press('Enter');
  await expect(button).toContainText(`${w.code}-A`);
  // the recent contexts, newest first; ArrowDown from the search box walks them, Enter on one chooses it
  await page.keyboard.press('Enter');
  const recent = page.getByTestId('context-recent');
  await expect(recent.getByRole('option')).toHaveText([new RegExp(`^${w.code}-A`), new RegExp(`^${w.code}-B`)]);
  await page.keyboard.press('ArrowDown'); await expect(recent.getByRole('option').first()).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(recent.getByRole('option').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(button).toContainText(`${w.code}-B`);
  // Escape closes the panel and gives focus back
  await page.keyboard.press('Enter'); await expect(page.getByLabel('Find a project or site')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Find a project or site')).toHaveCount(0);
  await expect(button).toBeFocused();
  // the recent contexts are kept on the server for the person: another browser shows them
  const other = await as(browser, info, w.company, 'PM', user, '/home');
  await other.getByTestId('context-button').click();
  await expect(other.getByTestId('context-recent').getByRole('option')).toHaveText([new RegExp(`^${w.code}-B`), new RegExp(`^${w.code}-A`)]);
  expect(errors).toEqual([]);
});
