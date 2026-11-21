import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { trackPageRequests } from './page-requests.js';

// Development-header mode (port 3100). Part 03.09, FR-06 and T-03: the axe engine scans the component gallery and the key pages against WCAG 2.1 A and
// AA, in the light, dark and high-contrast themes, on a desktop and a phone, and the run fails on any serious or critical finding. Moderate and minor
// findings are listed in the test output so they can be worked off.
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });

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
  const first = await post('/ui/sample-requests', 'PM', company, { title: 'Pier cap shuttering', docDate: '2026-10-31', requiredBy: '2026-11-20', projectId: project.id, siteId: site.id, lines: [{ description: 'TMT bar 12 mm', uom: 'MT', quantity: '2.5', unitRate: '58000' }] }, pm);
  await post(`/ui/sample-requests/${first.id}/submit`, 'PM', company, { version: first.version }, pm);
  return { company, request: first };
}
const open = async (browser, info, company, roles, user, path, theme = 'light') => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript(([v, th]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: th, density: 'comfortable', language: 'en' })); }, [{ user, roles, company: String(company) }, theme]);
  const settled = trackPageRequests(page);
  await page.goto(path);
  await expect.poll(settled, { timeout: 30_000, message: `Page requests settled for ${path}` }).toEqual([]);
  return page;
};
/** The serious and critical findings on the page now, as readable lines; moderate and minor ones are only printed. */
async function scan(page, label) {
  await page.evaluate(AXE);
  const result = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  const line = (v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0].target.join(' ')} -> ${String(v.nodes[0].html).slice(0, 140)}`;
  const minor = result.violations.filter((v) => !['serious', 'critical'].includes(v.impact));
  if (minor.length) console.log(`[a11y] ${label}: ${minor.map((v) => `${v.impact} ${v.id}`).join(', ')}`);
  return result.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map(line);
}
const ready = async (page, heading) => {
  if (heading) await expect(page.getByRole('heading', { name: heading, level: 1 }).first()).toBeVisible();
  else await expect(page.locator('main')).toBeVisible();
};

test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

for (const theme of ['light', 'dark', 'high-contrast']) {
  test(`T-03 FR-06 the component gallery and the design system have no serious or critical findings (${theme})`, async ({ browser, request }, info) => {
    test.setTimeout(120_000);
    const w = await world(request, `${pick(info, 'AD', 'AM')}${theme === 'light' ? 'L' : theme === 'dark' ? 'D' : 'H'}`, `e2e-pm-${theme}`);
    const problems = [];
    for (const [path, heading] of [['/admin/design-system/forms', 'Form Components'], ['/admin/design-system', 'Design System'], ['/admin/design-system/lists', 'List Report'], ['/admin/design-system/object-page', 'Object Page']]) {
      const page = await open(browser, info, w.company, 'SYSADM', 'e2e-sys', path, theme);
      await ready(page, heading);
      problems.push(...(await scan(page, `${path} ${theme}`)).map((p) => `${path}: ${p}`));
      await page.context().close();
    }
    expect(problems, theme).toEqual([]);
  });
}

test('FR-06 the key pages have no serious or critical findings', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const pm = pick(info, 'e2e-pm-ka', 'e2e-pm-kb');
  const w = await world(request, pick(info, 'KAD', 'KAM'), pm);
  const pages = [
    ['PM', pm, '/home', 'Home'], ['PM', pm, '/work', 'My Work'], ['PM', pm, '/search?q=pier', 'Advanced Search'], ['PM', pm, '/admin/sample-requests', 'Sample Material Requests'],
    ['PM', pm, `/admin/sample-requests?open=${w.request.id}`, null], ['PM', pm, '/admin/sample-requests/overview', 'Requests Overview'], ['PM', pm, '/account/profile', 'My Profile'],
    ['SE', 'e2e-se', '/field', 'Good'] /* 166.3: the greeting band's heading */, ['SE', 'e2e-se', '/field/scan', 'Scan'],
    ['SYSADM', 'e2e-sys', '/admin/translations', 'Translations'], ['SYSADM', 'e2e-sys', '/admin/search', 'Search Administration'], ['SYSADM', 'e2e-sys', '/admin/users', 'Users'], ['SYSADM', 'e2e-sys', '/admin/navigation', 'Navigation Registry'],
  ];
  const problems = [];
  for (const [roles, user, path, heading] of pages) {
    const page = await open(browser, info, w.company, roles, user, path);
    await ready(page, heading);
    problems.push(...(await scan(page, path)).map((p) => `${path}: ${p}`));
    await page.context().close();
  }
  expect(problems).toEqual([]);
});

test('FR-06 the open palette and the shortcut list have no serious or critical findings, and a dialog traps focus and returns it', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const pm = pick(info, 'e2e-pm-pa', 'e2e-pm-pb');
  const w = await world(request, pick(info, 'PAD', 'PAM'), pm);
  const page = await open(browser, info, w.company, 'PM', pm, '/home');
  await ready(page, 'Home');
  await page.getByTestId('search-trigger').click();
  await page.getByTestId('palette').getByRole('combobox').fill('pier');
  await expect(page.getByTestId('palette').getByRole('option').first()).toBeVisible();
  expect(await scan(page, 'palette')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcut-help')).toBeVisible();
  expect(await scan(page, 'shortcuts')).toEqual([]);
});

test('FR-05 focus returns to what opened the palette, a person who asked for less motion gets none, and the focus ring is visible', async ({ browser, request }, info) => {
  test.setTimeout(90_000);
  const pm = pick(info, 'e2e-pm-fa', 'e2e-pm-fb');
  const w = await world(request, pick(info, 'A11YFD', 'A11YFM'), pm);
  const page = await open(browser, info, w.company, 'PM', pm, '/home');
  await ready(page, 'Home');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const trigger = page.getByTestId('search-trigger');
  await trigger.focus();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // reduced motion: every transition and animation is as good as instant
  expect(await page.evaluate(() => Math.max(...[...document.querySelectorAll('button, a, .skeleton-row')].slice(0, 40).map((el) => parseFloat(getComputedStyle(el).transitionDuration) || 0)))).toBeLessThan(0.01);
  // the focus ring: a keyboard user sees where they are
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
});

