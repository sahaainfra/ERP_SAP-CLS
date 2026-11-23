import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 29.05 (AC-01, T-UI-01, T-UI-02): the Migration Cockpit on a 1280 px desktop and a 360 px phone. IT plans an object and its mapping
// workbook; the HR manager runs two trial loads (rolled back, reconciled); IT asks for the sign-off and a second HR manager signs; IT plans
// and starts the cut-over freeze; the final load is kept because it reconciles, and the object lands in the Loaded lane.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main .kpi-label, main .kpi-value')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('Migration cockpit: plan, map, two trial loads, sign-off, freeze and a reconciled final load', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { it: `mg-it-${suffix}`, hr: `mg-hr-${suffix}`, hr2: `mg-hr2-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `MGX-${suffix.toUpperCase()}`, legalName: 'Migration Demo Infrastructure', shortName: 'Migration Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['it', 'ITADM'], ['hr', 'HRMGR'], ['hr2', 'HRMGR']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2905', ?, 'Migration browser fixture', 0, 1)").run(company);
  } finally {
    db.close();
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.it, roles: 'ITADM', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const asUser = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };
  const code = `DES-${suffix.toUpperCase()}`;
  const csv = `Desig Code,Title,Lvl\nL-${suffix}-SE,Site Engineer,3\nL-${suffix}-PM,Project Manager,8\n`;

  // FR-01 IT plans the object; FR-02 its mapping workbook
  await page.goto('/admin/data-migration');
  await expect(page.getByRole('heading', { name: 'Migration Cockpit', level: 1 })).toBeVisible();
  await page.getByText('Plan an object').click();
  const planForm = page.locator('details.mig-section', { hasText: 'Plan an object' });
  await planForm.getByLabel('Code', { exact: true }).fill(code);
  await planForm.getByLabel('Name', { exact: true }).fill('Designations');
  await page.getByRole('combobox', { name: 'Kind of data' }).selectOption({ label: 'Designations' });
  await page.getByLabel('Owner role').fill('HRMGR');
  await page.getByRole('button', { name: 'Add to the plan' }).click();
  await expect(page.getByTestId('mig-object')).toContainText('Designations');
  await page.getByLabel(/Legacy column → column/).fill('Desig Code,code\nTitle,name\nLvl,level');
  await page.getByTestId('mig-save-map').click();
  await expect(page.getByTestId('mig-object')).toContainText('mapping v2');

  // FR-03 two trial loads by the owner, each rolled back and reconciled
  await asUser(users.hr, 'HRMGR');
  await page.goto(`/admin/data-migration?object=${code}`);
  for (let i = 0; i < 2; i += 1) {
    await page.getByLabel('Extract (CSV with a header row)').fill(csv);
    await page.getByTestId('mig-go').click();
    await expect(page.getByTestId('mig-runrow')).toHaveCount(i + 1);
  }
  await expect(page.getByTestId('mig-runrow').first()).toContainText('Passed');
  await expect(page.getByTestId('mig-runrow').first().locator('.mig-recon')).toContainText('Rows loaded');
  await expect(page.locator(`[data-testid="mig-tile"][data-code="${code}"]`)).toContainText('2 of 2 trials passed');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/29.05/${phone ? 'mobile' : 'desktop'}-migration-cockpit.png`, fullPage: true });
  await checkAppearance(page);

  // FR-05 IT asks for the sign-off; the second HR manager signs
  await asUser(users.it, 'ITADM');
  await page.goto(`/admin/data-migration?object=${code}`);
  await page.getByLabel('Reason for the sign-off').fill('Two clean trial loads against the legacy list');
  await page.getByTestId('mig-ask').click();
  await expect(page.getByTestId('mig-object')).toContainText('Waiting for sign-off');
  await asUser(users.hr2, 'HRMGR');
  await page.goto(`/admin/data-migration?object=${code}`);
  await page.getByTestId('mig-approve').click();
  await expect(page.getByTestId('mig-object')).toContainText('signed off by');

  // FR-04 IT plans and starts the cut-over freeze; the owner runs the final load
  await asUser(users.it, 'ITADM');
  await page.goto('/admin/data-migration');
  const local = (h) => { const d = new Date(Date.now() + h * 3_600_000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  await page.getByLabel('Name', { exact: true }).last().fill('Go-live weekend');
  await page.getByLabel('Freeze from').fill(local(-1));
  await page.getByLabel('Freeze to').fill(local(24));
  await page.getByLabel('Rollback point').fill('Backup before the freeze; the legacy system stays read-only');
  await page.getByRole('button', { name: 'Plan the cut-over' }).click();
  await page.getByTestId('mig-freeze').click();
  await expect(page.getByTestId('mig-k-cutover')).toContainText('Frozen');
  await asUser(users.hr, 'HRMGR');
  await page.goto(`/admin/data-migration?object=${code}`);
  await page.getByRole('combobox', { name: 'Load', exact: true }).selectOption('FINAL');
  await page.getByLabel('Extract (CSV with a header row)').fill(csv);
  await page.getByTestId('mig-go').click();
  await expect(page.getByTestId('mig-runrow').first()).toContainText('Loaded');
  await expect(page.locator('[data-lane="LOADED"]')).toContainText('Designations');
  const check = new DatabaseSync('data/e2e.sqlite');
  try { expect(check.prepare('SELECT COUNT(*) AS n FROM org_designations WHERE company_id = ? AND code LIKE ?').get(company, `L-${suffix}-%`).n).toBe(2); } finally { check.close(); }
  await noOverflow();
  expect(errors).toEqual([]);
});
