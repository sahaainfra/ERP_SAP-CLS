import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { todayIST } from '../src/shared/dates.js';

// Part 27.05 (T-UI-01, T-UI-02, AC-01, AC-07): the morning management report on a 1280 px desktop and a 360 px phone — the summary, the
// exceptions, the sections with drill links, the reproducibility check, the archive and the maker-checker settings; no horizontal scroll,
// tables as cards on the phone, no clipped labels at larger text in the dark and high-contrast themes, no console errors.

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
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test('Morning report: summary, exceptions, sections, reproducibility, archive and settings on desktop and phone', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const director = `mr-director-${suffix}`;
  const headers = (roles, company, user = director) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1), data: { code: `MR-${suffix.toUpperCase()}`, legalName: 'Morning Demo Infrastructure', shortName: 'Morning Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company), data: { legalName: 'Morning Demo Infrastructure', reason: 'Set up the morning report fixture' } })).ok()).toBe(true);
  const reportDate = addDays(todayIST(), -1);
  const dataDate = addDays(reportDate, -1);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [user, role] of [[director, 'DIR'], [`mr-cfo-${suffix}`, 'CFO']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, user, user, JSON.stringify([role]));
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Morning report browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2704', 'ff.bi.p2705']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    const project = (code, name) => Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'ROAD', 'ACTIVE')").run(company, code, name).lastInsertRowid);
    const site = (pid, code, name) => Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, ?, 'ACTIVE')").run(company, pid, code, name).lastInsertRowid);
    const ring = project('RING-01', 'Outer ring road package 1'); const tower = project('TWR-02', 'Hospital tower block');
    const sRing = site(ring, 'RING-S1', 'Ring road camp'); const sTower = site(tower, 'TWR-S1', 'Tower site');
    db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status, submitted_at) VALUES (?, 'DPR-R1', ?, ?, ?, 'sup', 'APPROVED', ?)").run(company, ring, sRing, dataDate, `${dataDate}T12:00:00Z`);
    for (const [person, s, status, minutes] of [[1, sRing, 'PRESENT', 480], [2, sRing, 'PRESENT', 540], [3, sTower, 'ABSENT', 0]]) db.prepare('INSERT INTO att_daily (company_id, person_id, work_date, daily_site_id, status, worked_minutes, computed_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(company, person, dataDate, s, status, minutes);
    const client = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, 'MR-CL', 'Metro Rail Corporation', 'metro rail corporation', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 'e2e', 'e2e')").run(company).lastInsertRowid);
    db.prepare("INSERT INTO ar_invoices (company_id, doc_no, invoice_no, inv_source, org_project_id, partner_id, invoice_date, due_date, amount_paise, received_paise, status) VALUES (?, 'AR-MR1', 'INV/26/118', 'OTHER_INCOME', ?, ?, ?, ?, 4250000000, 0, 'APPROVED')").run(company, ring, client, addDays(reportDate, -30), reportDate);
    db.prepare("INSERT INTO hse_incidents (company_id, doc_no, org_project_id, org_site_id, incident_type, classification, severity, occurred_at, description, reported_by, incident_status) VALUES (?, 'INC-07', ?, ?, 'INJURY', 'FIRST_AID', 'LOW', ?, 'Cut on hand', 'e2e', 'REPORTED')").run(company, tower, sTower, `${dataDate}T10:00`);
  } finally {
    db.close();
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: director, roles: 'DIR', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const checkWidths = async () => {
    const original = page.viewportSize();
    const widths = phone ? [320, 360, 375, 390, 430] : [768, 1024, 1366, 1920];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 768 });
      await noOverflow();
    }
    await page.setViewportSize(original);
  };

  await page.goto(`/bi/morning-report?date=${reportDate}`);
  await expect(page.getByRole('heading', { name: 'Morning Report', level: 1 })).toBeVisible();
  await expect(page.getByTestId('mr-asat')).toContainText('Reporting cutoff 06:00 IST');
  await expect(page.getByTestId('mr-summary-lines')).toContainText('DPRs for');
  await expect(page.getByTestId('mr-summary-lines')).toContainText('1 missing');
  await expect(page.getByTestId('mr-exceptions').locator('li[data-kind="DPR_MISSING"]')).toContainText('TWR-S1');
  await expect(page.getByTestId('mr-exceptions').locator('li[data-kind="COLLECTION_DUE"]')).toContainText('Metro Rail Corporation');
  await expect(page.getByTestId('mr-section-attendance')).toContainText('2');
  await expect(page.getByTestId('mr-section-receivables')).toContainText('4.25 Cr');
  await expect(page.getByTestId('mr-section-incidents')).toBeVisible();
  if (phone) expect(await page.getByTestId('mr-progress').locator('tbody tr').first().evaluate((row) => getComputedStyle(row).display)).not.toBe('table-row');
  await page.getByTestId('mr-verify').click();
  await expect(page.getByTestId('mr-verified')).toContainText('identical');
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.05/${phone ? 'mobile' : 'desktop'}-morning-report.png`, fullPage: true });
  await checkAppearance(page);
  await checkWidths();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('mr-export').click()]);
  expect(file.suggestedFilename()).toBe(`morning-report-${reportDate}.pdf`);

  // the archive lists the report; it opens the same figures
  await page.getByRole('tab', { name: 'Archive' }).click();
  await expect(page.getByRole('heading', { name: 'Report Archive', level: 1 })).toBeVisible();
  await expect(page.getByTestId('mr-archive-row')).toHaveCount(1);
  await checkWidths();
  await page.screenshot({ path: `docs/erp/screenshots/27.05/${phone ? 'mobile' : 'desktop'}-report-archive.png`, fullPage: true });
  await page.getByTestId('mr-archive-row').getByRole('link').click();
  await expect(page.getByTestId('mr-summary-lines')).toContainText('1 missing');

  // settings: a director proposes the role configuration; it waits for the CFO or another director
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByTestId('mr-settings-configs').getByRole('button', { name: 'Propose a configuration' }).click();
  await page.getByLabel('Role code or user name').fill('DIR');
  await page.getByLabel('E-mail').check();
  await page.getByLabel('Reason for the change').fill('Directors get the digest by 06:30 every day');
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByTestId('mr-settings-pending').getByText('Morning report for role DIR')).toBeVisible();
  await expect(page.getByTestId('mr-settings-pending').getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/27.05/${phone ? 'mobile' : 'desktop'}-morning-report-settings.png`, fullPage: true });
  expect(errors).toEqual([]);
});
