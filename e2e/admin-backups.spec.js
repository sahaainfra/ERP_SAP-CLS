import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 29.06 (AC-01, T-01, T-UI-01, T-UI-02): Backup & DR on a 1280 px desktop and a 360 px phone. IT takes a full backup (verified,
// encrypted off site) and runs a DR drill that restores within the RTO with loss within the RPO; the status turns healthy; a production
// restore with its incident is approved by a second IT administrator and a director, and the operator's command is shown.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main button, main .kpi-label, main .kpi-value')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('Backup & DR: a verified backup, a drill within RPO and RTO, and a production restore approved by IT and a director', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { it: `bk-it-${suffix}`, it2: `bk-it2-${suffix}`, dir: `bk-dir-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `BKP-${suffix.toUpperCase()}`, legalName: 'Backup Demo Infrastructure', shortName: 'Backup Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['it', 'ITADM'], ['it2', 'ITADM'], ['dir', 'DIR']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2906', ?, 'Backup browser fixture', 0, 1)").run(company);
    // one production restore may be open at a time across the platform: an earlier run's approved request is closed first
    db.prepare("UPDATE ops_restore_requests SET status = 'REJECTED' WHERE status IN ('SUBMITTED', 'APPROVED')").run();
  } finally {
    db.close();
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.it, roles: 'ITADM', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const asUser = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };

  // FR-01 a full backup, verified and copied encrypted off site
  await page.goto('/admin/backups');
  await expect(page.getByRole('heading', { name: 'Backup & DR', level: 1 })).toBeVisible();
  await page.getByTestId('bkp-full').click();
  await expect(page.getByTestId('bkp-result')).toContainText('Verified', { timeout: 30_000 });
  // T-01 FR-04 the drill restores in isolation within the RTO, with loss within the RPO
  await page.getByTestId('bkp-drill').click();
  await expect(page.getByTestId('bkp-drill-result')).toContainText('Drill Passed', { timeout: 30_000 });
  await expect(page.getByTestId('bkp-k-drill')).toContainText('Passed');
  await expect(page.getByTestId('bkp-k-offsite')).toContainText('In place');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/29.06/${phone ? 'mobile' : 'desktop'}-backup-dr-status.png`, fullPage: true });
  await checkAppearance(page);
  await page.getByRole('tab', { name: 'Restore tests & drills' }).click();
  await expect(page.getByTestId('bkp-testrow').first()).toContainText('DR drill');
  await expect(page.getByTestId('bkp-testrow').first()).toContainText('Integrity, row counts and table checksums');

  // BR-01 a production restore: incident documented, ITADM then DIR
  await page.getByRole('tab', { name: 'Production restore' }).click();
  await page.getByRole('combobox', { name: 'Backup', exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Incident reference').fill(`INC-${suffix}-1`);
  await page.getByLabel('What happened').fill('The database disk failed during the night');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByTestId('bkp-requests')).toContainText('Waiting for approval');
  await asUser(users.it2, 'ITADM');
  await page.goto('/admin/backups?tab=restores');
  await page.getByTestId('bkp-requests').getByRole('button', { name: 'Approve' }).click();
  await asUser(users.dir, 'DIR');
  await page.goto('/admin/backups?tab=restores');
  await page.getByTestId('bkp-requests').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('bkp-requests')).toContainText('Approved');
  await expect(page.getByTestId('bkp-requests')).toContainText('npm run db:restore -- --approved');
  await noOverflow();
  expect(errors).toEqual([]);
});
