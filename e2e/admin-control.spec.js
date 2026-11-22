import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

// Part 29.01 (AC-01, T-01, T-UI-01, T-UI-02): the Enterprise Control Center on a 1280 px desktop and a 360 px phone. The governance dashboard;
// the system administrator requests a feature-flag change and IT approves it in the admin approvals (applied only then); IT turns read-only
// mode on (every page says so) and ends it; a snapshot from "UAT" is compared and one difference is raised as a change request.

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

test('Enterprise Control Center: governance, a maker-checker change, read-only mode and an environment diff', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { sys: `cc-sys-${suffix}`, it: `cc-it-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `CCX-${suffix.toUpperCase()}`, legalName: 'Control Demo Infrastructure', shortName: 'Control Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company, 'setup'), data: { legalName: 'Control Demo Infrastructure', reason: 'Set up the control fixture' } })).ok()).toBe(true);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['sys', 'SYSADM'], ['it', 'ITADM']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2901', ?, 'Control browser fixture', 0, 1)").run(company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
  } finally {
    db.close();
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 423/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.sys, roles: 'SYSADM', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const asUser = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };

  // FR-02 the governance dashboard
  await page.goto('/admin/control');
  await expect(page.getByRole('heading', { name: 'Enterprise Control Center', level: 1 })).toBeVisible();
  await expect(page.getByTestId('adm-approvals')).toBeVisible();
  await expect(page.getByTestId('adm-m-dormant')).toBeVisible();
  // backups are platform-wide (29.06): the tile shows the last one, or that there is none yet
  await expect(page.getByTestId('adm-m-backup')).toContainText(/None yet|Verified|Failed/);
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/29.01/${phone ? 'mobile' : 'desktop'}-enterprise-control-center.png`, fullPage: true });
  await checkAppearance(page);

  // BR-01 the system administrator requests a change; nothing applies until IT approves
  const areas = async () => (await (await request.get('/api/v1/admin/areas', { headers: headers('SYSADM', company, users.sys) })).json()).data.FEATURE_FLAG.find((f) => f.key === 'ff.ai.p2801').value;
  const before = await areas();
  await page.getByTestId('adm-tabs').getByRole('tab', { name: 'Request a change' }).click();
  await page.getByLabel('Setting *').fill('ff.ai.p2801');
  await expect(page.getByTestId('adm-current')).toContainText(String(before));
  await page.getByLabel('New value *').selectOption(before ? 'false' : 'true');
  await page.getByLabel('Reason *').fill('Pilot the AI gateway at this company');
  await page.getByTestId('adm-submit-change').click();
  await expect(page.getByTestId('adm-sent')).toContainText('ITADM');
  expect(await areas()).toBe(before);
  await asUser(users.it, 'ITADM');
  await page.goto('/admin/control?tab=approvals');
  const req = page.getByTestId('adm-request').filter({ hasText: 'ff.ai.p2801' });
  await req.getByTestId('adm-approve').click();
  await expect(page.getByTestId('adm-request').filter({ hasText: 'ff.ai.p2801' })).toHaveCount(0);
  expect(await areas()).toBe(!before);

  // FR-05 read-only mode: on at once, every page says so, then ended (each action waits for ratification)
  await page.getByTestId('adm-tabs').getByRole('tab', { name: 'Emergency controls' }).click();
  await page.getByLabel('Reason *').fill('Suspected corruption of the ledger');
  await page.getByTestId('adm-ro').click();
  await expect(page.getByTestId('adm-emergency')).toContainText('Read-only');
  await page.getByTestId('adm-tabs').getByRole('tab', { name: 'Governance' }).click();
  await expect(page.getByTestId('adm-readonly')).toBeVisible();
  const blocked = await request.post('/api/v1/admin/snapshots', { headers: headers('SYSADM', company, users.sys), data: {} });
  expect(blocked.status()).toBe(423);
  await page.getByTestId('adm-tabs').getByRole('tab', { name: 'Emergency controls' }).click();
  await page.getByLabel('Reason *').fill('Ledger verified, resuming work');
  await page.getByTestId('adm-ro').click();
  await expect(page.getByTestId('adm-emergency')).toContainText('Normal operation');
  await expect(page.getByTestId('adm-actions').locator('li')).toHaveCount(2);

  // T-01 FR-03 compare with "UAT": exactly the differences, one raised as a change request
  await asUser(users.sys, 'SYSADM');
  const snap = (await (await request.post('/api/v1/admin/snapshots', { headers: headers('SYSADM', company, users.sys), data: { note: 'production' } })).json()).data;
  const file = JSON.parse(await (await request.get(`/api/v1/admin/snapshots/${snap.id}/export`, { headers: headers('SYSADM', company, users.sys) })).text());
  const uat = JSON.parse(JSON.stringify(file.content)); uat.PARAMETER['ai.anomaly.z_threshold'] = '4.5';
  const other = { ...file, environment: 'uat', content: uat, checksum: createHash('sha256').update(JSON.stringify(uat)).digest('hex') };
  await page.goto('/admin/control?tab=snapshots');
  await page.getByTestId('adm-file').setInputFiles({ name: 'uat.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(other)) });
  await expect(page.getByTestId('adm-diff-row')).toHaveCount(1);
  await expect(page.getByTestId('adm-diff-row')).toContainText('4.5');
  await page.getByTestId('adm-diff-row').getByRole('checkbox').check();
  await page.getByLabel('Reason *').fill('Align production with UAT');
  await page.getByTestId('adm-import').click();
  await expect(page.getByTestId('adm-imported')).toContainText('1 change requests');
  // FR-04 the onboarding checklist
  await page.getByTestId('adm-tabs').getByRole('tab', { name: 'Company onboarding' }).click();
  await expect(page.getByTestId('adm-step')).toHaveCount(6);
  await expect(page.getByTestId('adm-step').first()).toHaveAttribute('data-done', 'true');
  await noOverflow();
  expect(errors).toEqual([]);
});
