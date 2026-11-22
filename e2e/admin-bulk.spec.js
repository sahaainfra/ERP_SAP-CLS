import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 29.04 (AC-01, T-01, T-UI-01, T-UI-02): template packs and the bulk entry workspace on a 1280 px desktop and a 360 px phone. An HR
// manager opens the Masters pack, pastes rows copied from Excel into the grid, sees the cells in error highlighted, corrects them, saves the
// draft and submits it; a second HR manager approves the batch and the designations are imported together.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main .tabs button, main .bk-card > .actions-row button')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('Bulk entry: paste from Excel, cells in error highlighted, a batch submitted whole and approved by the module approver', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { hr1: `bk-hr1-${suffix}`, hr2: `bk-hr2-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `BKX-${suffix.toUpperCase()}`, legalName: 'Bulk Demo Infrastructure', shortName: 'Bulk Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const k of ['hr1', 'hr2']) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify(['HRMGR']));
    db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2904', ?, 'Bulk browser fixture', 0, 1)").run(company);
  } finally {
    db.close();
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 422/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.hr1, roles: 'HRMGR', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // FR-01 the packs by module
  await page.goto('/admin/bulk');
  await expect(page.getByRole('heading', { name: 'Template Packs & Bulk Entry', level: 1 })).toBeVisible();
  const masters = page.locator('[data-testid="bk-pack"][data-code="masters"]');
  await expect(masters).toContainText('Version 1');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/29.04/${phone ? 'mobile' : 'desktop'}-template-packs-by-module.png`, fullPage: true });
  await checkAppearance(page);

  // FR-02 T-01 paste rows from Excel; the cells in error are highlighted with the reason
  await masters.getByTestId('bk-template').filter({ hasText: 'Designations' }).getByTestId('bk-enter').click();
  if (phone) await expect(page.getByTestId('bk-desk')).toBeVisible();
  await expect(page.getByTestId('bk-grid')).toBeVisible();
  const code = `E${suffix.toUpperCase()}`;
  const tsv = [`${code}-SE\tSite Engineer\tG3\t3`, `bad code!\tFitter\tG1\t1`, `${code}-PM\tProject Manager\tG7\t99`].join('\n');
  await page.locator('#bk-0-code').evaluate((el, text) => { const dt = new DataTransfer(); dt.setData('text/plain', text); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, tsv);
  await expect(page.locator('#bk-2-name')).toHaveValue('Project Manager');
  await expect(page.locator('#bk-1-code')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#bk-2-level')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#bk-0-code')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('bk-summary')).toContainText('2 with errors');
  // corrected in the grid
  await page.locator('#bk-1-code').fill(`${code}-FT`);
  await page.locator('#bk-2-level').fill('7');
  await expect(page.getByTestId('bk-summary')).toContainText('0 with errors');
  await page.getByLabel('Batch title').fill('Designations for the new region');
  await page.getByTestId('bk-save').click();
  await expect(page.getByTestId('bk-batch')).toContainText('Draft');
  await page.getByLabel('Reason for the batch').fill('New region opens next month');
  await page.getByTestId('bk-submit').click();
  await expect(page.getByTestId('bk-batch')).toContainText('Waiting for approval');
  await noOverflow();

  // section 9 the module approver approves; the rows are imported together
  await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: users.hr2, roles: 'HRMGR', company: String(company) });
  await page.goto('/admin/bulk?tab=batches&scope=approve');
  await page.getByTestId('bk-batch-card').first().getByTestId('bk-approve').click();
  await expect(page.getByTestId('bk-batch-card').first()).toContainText('Imported');
  await expect(page.getByTestId('bk-batch-card').first()).toContainText('3 created');
  const check = new DatabaseSync('data/e2e.sqlite');
  try { expect(check.prepare('SELECT COUNT(*) AS n FROM org_designations WHERE company_id = ? AND code LIKE ?').get(company, `${code}-%`).n).toBe(3); } finally { check.close(); }
  await noOverflow();
  expect(errors).toEqual([]);
});
