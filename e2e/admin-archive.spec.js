import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 29.07 (AC-01, T-01, T-UI-01, T-UI-02): Retention & Archival on a 1280 px desktop and a 360 px phone. SYSADM sets the retention
// policy of daily progress reports; the auditor places a legal hold on one report; SYSADM previews and raises an archival job that skips it;
// the auditor approves; the archived report opens read-only from the archive with its snapshot and trail.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main .tabs button, main .kpi-label, main .kpi-value')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('Retention & archival: a policy, a legal hold, an approved archival job that skips it, and a read-only archived record', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { sys: `ar-sys-${suffix}`, aud: `ar-aud-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `ARX-${suffix.toUpperCase()}`, legalName: 'Archive Demo Infrastructure', shortName: 'Archive Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  let held;
  try {
    for (const [k, r] of [['sys', 'SYSADM'], ['aud', 'AUD']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2907', ?, 'Archive browser fixture', 0, 1)").run(company);
    const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Old tower', 'BUILDING', 'ACTIVE')").run(company, `AP-${suffix}`).lastInsertRowid);
    const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Old tower site', 'ACTIVE')").run(company, project, `AS-${suffix}`).lastInsertRowid);
    const cols = db.prepare('PRAGMA table_info(site_dprs)').all().filter((c) => c.notnull && c.dflt_value == null && c.name !== 'id');
    const dpr = (no, date) => { const vals = { company_id: company, doc_no: no, org_project_id: project, dpr_date: date, status: 'APPROVED', dpr_site_id: site }; const names = [...new Set([...cols.map((c) => c.name), ...Object.keys(vals)])]; return Number(db.prepare(`INSERT INTO site_dprs (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((n) => (n in vals ? vals[n] : /INT/i.test(cols.find((c) => c.name === n)?.type ?? '') ? 1 : `x-${n}`))).lastInsertRowid); };
    dpr(`DPR-${suffix}-001`, '2024-02-01'); held = dpr(`DPR-${suffix}-002`, '2024-02-02'); dpr(`DPR-${suffix}-003`, '2024-02-03');
  } finally {
    db.close();
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.sys, roles: 'SYSADM', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const asUser = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };

  // FR-01 the policy with its legal basis
  await page.goto('/admin/archive');
  await expect(page.getByRole('heading', { name: 'Retention & Archival', level: 1 })).toBeVisible();
  const card = page.locator('[data-testid="arc-policy"][data-class="site.dpr"]');
  await card.getByLabel('Archive after (months)').fill('12');
  await card.getByLabel('Keep for (years)').fill('8');
  await card.getByRole('combobox', { name: 'Then' }).selectOption('DISPOSE');
  await card.getByLabel('Legal basis').fill('Contract clause 14: site records kept eight years after completion');
  await card.getByTestId('arc-save-policy').click();
  await expect(card).toContainText('Policy set');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/29.07/${phone ? 'mobile' : 'desktop'}-retention-policies.png`, fullPage: true });
  await checkAppearance(page);

  // FR-04 the auditor places a legal hold on one report
  await asUser(users.aud, 'AUD');
  await page.goto('/admin/archive?tab=holds');
  await page.getByRole('combobox', { name: 'Hold on' }).selectOption('site.dpr');
  await page.getByLabel('Record id').fill(String(held));
  await page.getByLabel('Reason', { exact: true }).fill('Arbitration over February progress');
  await page.getByTestId('arc-hold').click();
  await expect(page.getByTestId('arc-holdrow').first()).toContainText(`DPR-${suffix}-002`);

  // FR-02 SYSADM previews and raises the job; the auditor approves; the held report is skipped
  await asUser(users.sys, 'SYSADM');
  await page.goto('/admin/archive?tab=jobs');
  await page.getByTestId('arc-preview').click();
  await expect(page.getByTestId('arc-preview-result')).toContainText('2 record(s) are due; 1 on legal hold');
  await page.getByLabel('Reason', { exact: true }).fill('Archival of 2024 site records');
  await page.getByTestId('arc-create-job').click();
  await expect(page.getByTestId('arc-job').first()).toContainText('Waiting for approval');
  await asUser(users.aud, 'AUD');
  await page.goto('/admin/archive?tab=jobs');
  await page.getByTestId('arc-job').first().getByTestId('arc-approve').click();
  await expect(page.getByTestId('arc-job').first()).toContainText('2 archived · 1 skipped on hold');

  // T-01 FR-03 the archived record: retrievable and read-only, with its snapshot and trail
  await page.goto(`/admin/archive?tab=records&q=DPR-${suffix}-001`);
  await page.getByTestId('arc-open').first().click();
  await expect(page.getByTestId('arc-view')).toContainText('Read-only');
  await expect(page.getByTestId('arc-view')).toContainText('Snapshot intact');
  await expect(page.getByTestId('arc-view')).toContainText(`DPR-${suffix}-001`);
  await noOverflow();
  const check = new DatabaseSync('data/e2e.sqlite');
  try { expect(() => check.prepare("UPDATE site_dprs SET status = 'CANCELLED' WHERE doc_no = ? AND company_id = ?").run(`DPR-${suffix}-001`, company)).toThrow(/ARCHIVED/); } finally { check.close(); }
  expect(errors).toEqual([]);
});
