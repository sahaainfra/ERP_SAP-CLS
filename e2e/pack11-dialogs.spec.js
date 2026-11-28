import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// PACK-11: the keyboard and axe per dialog type, desktop and phone (development-header mode, port 3100).
//  - form dialog (FormDialog, Organisation › New project): focus moves in, Tab stays inside, Escape closes, focus returns to the opener;
//  - confirmation dialog with a reason (ConfirmDialog, a List Report bulk cancel): the same, and the reason fields are labelled;
//  - the List Report's filter sheet on a phone: Escape closes it and focus returns.
// On the phone the dialogs are full-screen sheets. axe (WCAG 2.1 A and AA) runs on each open dialog.
// The typed confirmation for a salary transfer release is in e2e/pay-p2405.spec.js.
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const pick = (info, d, m) => (info.project.name === 'desktop' ? d : m);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

async function company(request, code) {
  const post = async (path, roles, c, data, user = 'e2e-setup') => {
    const res = await request.post(`/api/v1${path}`, { headers: H(roles, c, user), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const id = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const cur = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = cur.ok() ? (await cur.json()).data?.version : undefined;
  await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } });
  await post('/core/financial-years', 'SYSADM', id, { startDate: '2026-04-01' });
  return { id, post };
}
const page = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const p = await context.newPage();
  await p.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await p.goto(path);
  return p;
};
const inside = (p, sel) => p.evaluate((s) => { const d = document.querySelector(s); return Boolean(d && d.contains(document.activeElement)); }, sel);
// A native modal dialog keeps focus off the page behind it (inert); Tab past its last control goes to the browser's own toolbar (the
// document body is then the active element) and comes back into the dialog. Never on a control of the page behind is the rule.
const notBehind = (p, sel) => p.evaluate((s) => { const d = document.querySelector(s); const a = document.activeElement; return Boolean(d && (d.contains(a) || a === document.body || a === null)); }, sel);

/** The checks every dialog passes: focus inside, Tab kept inside, axe clean, a full-screen sheet on the phone. */
async function checkOpen(p, info, sel) {
  const dialog = p.locator(sel);
  await expect(dialog).toBeVisible();
  expect(await inside(p, sel), 'focus moves into the dialog').toBe(true);
  let cameBack = false;
  for (let i = 0; i < 16; i += 1) {
    await p.keyboard.press('Tab');
    expect(await notBehind(p, sel), `Tab ${i + 1}: focus never on the page behind the dialog`).toBe(true);
    if (i > 0 && await inside(p, sel)) cameBack = true;
  }
  for (let i = 0; i < 6; i += 1) { await p.keyboard.press('Shift+Tab'); expect(await notBehind(p, sel), `Shift+Tab ${i + 1}`).toBe(true); }
  expect(cameBack, 'Tab cycles back into the dialog').toBe(true);
  if (info.project.name === 'mobile') {
    const box = await dialog.boundingBox(); const vp = p.viewportSize();
    expect(Math.round(box.width), 'full-screen sheet: width').toBeGreaterThanOrEqual(vp.width - 1);
    expect(Math.round(box.height), 'full-screen sheet: height').toBeGreaterThanOrEqual(vp.height - 1);
  }
  await p.evaluate(AXE); // as e2e/a11y.spec.js: the page's CSP refuses an inline <script>
  const ax = await p.evaluate(([s, tags]) => window.axe.run(document.querySelector(s), { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), [sel, TAGS]);
  expect(ax.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test('PACK-11 form dialog: focus in, Tab kept inside, Escape closes, focus back on the opener; axe clean; a sheet on the phone', async ({ browser, request }, info) => {
  const c = await company(request, pick(info, 'DLFD', 'DLFM'));
  const p = await page(browser, info, c.id, 'SYSADM', pick(info, 'e2e-dlg-d', 'e2e-dlg-m'), '/admin/organisation');
  const opener = p.getByRole('button', { name: /^New / }).first();
  await expect(opener).toBeVisible();
  await opener.click();
  const sel = 'dialog[open]';
  await checkOpen(p, info, sel);
  await p.keyboard.press('Escape');
  await expect(p.locator(sel)).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('PACK-11 confirmation dialog with a reason: labelled fields, focus kept and returned, axe clean; a sheet on the phone', async ({ browser, request }, info) => {
  test.setTimeout(90_000);
  const c = await company(request, pick(info, 'DLCD', 'DLCM'));
  await c.post('/core/number-series', 'SYSADM', c.id, { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' });
  const project = await c.post('/iam/org/projects', 'PM', c.id, { code: `${pick(info, 'DLCD', 'DLCM')}-P`, name: 'Ring Road', type: 'ROAD' });
  const me = pick(info, 'e2e-cnf-d', 'e2e-cnf-m');
  await c.post('/ui/sample-requests', 'PM', c.id, { title: 'Cement lot', docDate: '2026-11-02', requiredBy: '2026-12-20', projectId: project.id, lines: [{ description: 'Cement', uom: 'BAG', quantity: '10', unitRate: '400' }] }, me);
  const p = await page(browser, info, c.id, 'PM', me, '/admin/sample-requests');
  await expect(p.getByText('1 requests, page 1 of 1').or(p.getByText('1 request, page 1 of 1'))).toBeVisible();
  await p.getByRole('checkbox', { name: /^Select (?!every)/ }).first().check();
  const opener = p.getByRole('button', { name: 'Cancel selected' });
  await opener.click();
  const sel = '[data-testid="confirm-dialog"]';
  await checkOpen(p, info, sel);
  await expect(p.locator(sel).getByLabel(/reason/i).first()).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.locator(sel)).toBeHidden();
  await expect(opener).toBeFocused();
});

test('PACK-11 List Report filter sheet on a phone: Escape closes it and focus returns to the Filters button', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'the filter sheet is the phone layout');
  const c = await company(request, 'DLSM');
  const f = await request.patch('/api/v1/core/feature-flags/ff.ui.p16607', { headers: H('SYSADM', c.id, 'e2e-setup'), data: { scope: { level: 'company', companyId: c.id }, enabled: true, reason: 'e2e: PACK-11 filter sheet' } });
  expect(f.status(), await f.text()).toBe(200);
  const p = await page(browser, info, c.id, 'PM', 'e2e-sheet-m', '/admin/sample-requests');
  const opener = p.getByRole('button', { name: /^Filters/ }).first();
  await expect(opener).toBeVisible();
  await opener.click();
  const sheet = p.locator('.lr-sheet-head').first();
  await expect(sheet).toBeVisible();
  await expect(p.getByTestId('filter-sheet-close')).toBeFocused();
  for (let i = 0; i < 30; i += 1) { await p.keyboard.press('Tab'); expect(await inside(p, '[data-testid="filter-sheet"]'), `Tab ${i + 1} stays in the sheet`).toBe(true); }
  await p.evaluate(AXE);
  const ax = await p.evaluate((tags) => window.axe.run(document.querySelector('[data-testid="filter-sheet"]'), { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  expect(ax.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  await p.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});
