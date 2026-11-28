import { test, expect } from '@playwright/test';

// PACK-09: drafts on long forms. With ff.forms.pack09 on, the rows pasted into Import Client BOQ are kept on the server when the person
// leaves the field; after a reload (a closed tab, a crash) the page offers the draft back, and resuming it restores the rows. While the
// rows are not added, moving to another page asks first, and staying keeps them. Development-header mode (port 3100).
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
const pick = (info, d, m) => (info.project.name === 'desktop' ? d : m);
const ROWS = ['Section\tSection name\tItem\tDescription\tUnit\tQuantity\tClient rate', 'A\tEarthwork\tA.1\tExcavation in ordinary soil\tCUM\t250\t310', 'A\tEarthwork\tA.2\tBackfilling with excavated earth\tCUM\t120\t140'].join('\n');

test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

test('PACK-09 a draft of pasted BOQ rows survives a reload, is offered back and restores the rows; leaving with unsaved rows asks first', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const code = pick(info, 'FDRD', 'FDRM');
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-setup'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const c = (await res.json()).data.id;
  for (const key of ['ff.forms.pack09', 'ff.est.p0901']) {
    const f = await request.patch(`/api/v1/core/feature-flags/${key}`, { headers: H('SYSADM', c, 'e2e-setup'), data: { scope: { level: 'company', companyId: c }, enabled: true, reason: 'e2e: PACK-09 drafts' } });
    expect(f.status(), `${key}: ${await f.text()}`).toBe(200);
  }
  const user = pick(info, 'e2e-draft-d', 'e2e-draft-m');
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles: 'EST', company: String(c) });
  await page.goto('/est/import');
  await expect(page.getByTestId('boq-import')).toBeVisible();
  await expect(page.getByTestId('draft-banner')).toHaveCount(0);

  // paste, leave the field: the draft goes to the server
  const saved = page.waitForResponse((r) => r.url().includes('/api/v1/ui/drafts/est.boq_import') && r.request().method() === 'PUT' && r.status() === 200, { timeout: 15_000 });
  await page.getByTestId('imp-text').fill(ROWS);
  await expect(page.getByTestId('imp-count')).toContainText('2');
  await page.getByTestId('imp-replace').focus();
  await saved;

  // a reload loses the page's state; the draft is offered back and restores the rows
  await page.reload();
  await expect(page.getByTestId('boq-import')).toBeVisible();
  await expect(page.getByTestId('imp-text')).toHaveValue('');
  const banner = page.getByTestId('draft-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('You have a draft');
  await banner.getByRole('button', { name: 'Resume the draft' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId('imp-text')).toHaveValue(ROWS);
  await expect(page.getByTestId('imp-count')).toContainText('2');

  // the rows are not added yet: going to another page asks first; staying keeps the page and its rows
  let asked = '';
  page.once('dialog', async (d) => { asked = d.message(); await d.dismiss(); });
  await page.getByRole('link', { name: /Import Center/i }).click();
  await expect.poll(() => asked).toContain('not saved');
  await expect(page).toHaveURL(/\/est\/import/);
  await expect(page.getByTestId('imp-text')).toHaveValue(ROWS);

  // discarding the draft: a reload offers nothing
  await page.getByTestId('imp-text').fill('');
  await page.reload();
  await page.getByTestId('draft-banner').getByRole('button', { name: 'Discard it' }).click();
  await expect(page.getByTestId('draft-banner')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('boq-import')).toBeVisible();
  await expect(page.getByTestId('draft-banner')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('PACK-09 with the flag off the page keeps no draft and asks nothing (no change for companies that have not turned it on)', async ({ browser, request }, info) => {
  const code = pick(info, 'FDOD', 'FDOM');
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-setup'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const c = (await res.json()).data.id;
  const f = await request.patch('/api/v1/core/feature-flags/ff.est.p0901', { headers: H('SYSADM', c, 'e2e-setup'), data: { scope: { level: 'company', companyId: c }, enabled: true, reason: 'e2e: PACK-09 flag off' } });
  expect(f.status(), await f.text()).toBe(200);
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: pick(info, 'e2e-nodraft-d', 'e2e-nodraft-m'), roles: 'EST', company: String(c) });
  const drafts = [];
  page.on('request', (r) => { if (r.url().includes('/api/v1/ui/drafts/')) drafts.push(r.method()); });
  await page.goto('/est/import');
  await page.getByTestId('imp-text').fill(ROWS);
  await page.getByTestId('imp-replace').focus();
  await page.waitForTimeout(2500);
  expect(drafts).toEqual([]);
  let asked = false;
  page.once('dialog', async (d) => { asked = true; await d.accept(); });
  await page.getByRole('link', { name: /Import Center/i }).click();
  await expect(page).toHaveURL(/\/import/);
  expect(asked).toBe(false);
});

test('PACK-09 identifier fields on Register Worker tidy and check the value when the person leaves the field; the server checks the same', async ({ browser, request }, info) => {
  const code = pick(info, 'FIDD', 'FIDM');
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-setup'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const c = (await res.json()).data.id;
  for (const key of ['ff.forms.pack09', 'ff.hr.p0708']) {
    const f = await request.patch(`/api/v1/core/feature-flags/${key}`, { headers: H('SYSADM', c, 'e2e-setup'), data: { scope: { level: 'company', companyId: c }, enabled: true, reason: 'e2e: PACK-09 identifiers' } });
    expect(f.status(), `${key}: ${await f.text()}`).toBe(200);
  }
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: pick(info, 'e2e-ids-d', 'e2e-ids-m'), roles: 'WSUP', company: String(c) });
  await page.goto('/labour/workers/new');
  await expect(page.getByTestId('register-worker')).toBeVisible();

  const ifsc = page.getByLabel('IFSC (with the account)');
  await ifsc.fill('sbin 000 1234');
  await ifsc.press('Tab');
  await expect(ifsc).toHaveValue('SBIN0001234');
  await expect(ifsc).not.toHaveAttribute('aria-invalid', 'true');
  await ifsc.fill('SBIN1001234');
  await ifsc.press('Tab');
  await expect(ifsc).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('An IFSC is four letters, a zero and six letters or digits')).toBeVisible();

  const aadhaar = page.getByLabel('ID number (Aadhaar)');
  await aadhaar.fill('2341 2341 2341');
  await aadhaar.press('Tab');
  await expect(page.getByText('This is not a valid Aadhaar number (its check digit is wrong)')).toBeVisible();
  await aadhaar.fill('2341 2341 2346');
  await aadhaar.press('Tab');
  await expect(aadhaar).toHaveValue('234123412346');
  await expect(aadhaar).not.toHaveAttribute('aria-invalid', 'true');

  const mobile = page.getByLabel('Mobile', { exact: true });
  await mobile.fill('+91 98765 43210');
  await mobile.press('Tab');
  await expect(mobile).toHaveValue('9876543210');

  // the server refuses what the field refuses, with the same words
  const bad = await request.post('/api/v1/hr/workers', { headers: H('WSUP', c, 'e2e-ids'), data: { name: 'Test Worker', dob: '1990-01-01', gender: 'MALE', tradeCode: 'HELPER', skillCategory: 'UNSKILLED', contractorId: 1, ifsc: 'SBIN1001234' } });
  expect(bad.status()).toBe(400); // the repository's validation status
  expect(await bad.text()).toContain('An IFSC is four letters, a zero and six letters or digits');
  expect(errors).toEqual([]);
});
