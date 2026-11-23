import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { todayIST } from '../src/shared/dates.js';

// Part 27.07 (T-UI-01, T-UI-02, AC-01, AC-07): the monthly close status board and the project monthly close on a 1280 px desktop and a 360 px
// phone — start a close from the board, see the step that blocks it, send it when ready, the QS → PM → PD chain, the locked close with its
// Project MIS and Budget Master; one board column at a time on a phone; no overflow, no clipped labels, no console errors.

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
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

test('Monthly close: board, blocked step, chain QS → PM → PD, locked close with MIS and Budget Master', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const sfx = phone ? 'm' : 'd';
  const user = (r) => `mc-${r.toLowerCase()}-${sfx}`;
  const headers = (roles, company, u = user(roles)) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': u, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'mc-admin'), data: { code: `MC-${sfx.toUpperCase()}`, legalName: 'Close Demo Infrastructure', shortName: 'Close Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company, 'mc-admin'), data: { legalName: 'Close Demo Infrastructure', reason: 'Set up the close fixture' } })).ok()).toBe(true);
  const fy = await request.post('/api/v1/core/financial-years', { headers: headers('SYSADM', company, 'mc-admin'), data: { startDate: '2026-04-01' } });
  expect(fy.status(), await fy.text()).toBeLessThan(300);
  const now = todayIST().slice(0, 7);
  const [y, m] = now.split('-').map(Number);
  const period = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const from = `${period}-01`; const to = monthEnd(period);
  let project; let site;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const r of ['PCMGR', 'QS', 'PM', 'PD']) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, user(r), user(r), JSON.stringify([r]));
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Close browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2707']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'MTR-01', 'Metro viaduct package 1', 'ROAD', 'ACTIVE')").run(company).lastInsertRowid);
    db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'RNG-02', 'Ring road package 2', 'ROAD', 'ACTIVE')").run(company);
    site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, 'MTR-S1', 'Viaduct site', 'ACTIVE')").run(company, project).lastInsertRowid);
    db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status) VALUES (?, ?, ?, ?, ?, 'sup', 'APPROVED')").run(company, `DPR-MC-${sfx}`, project, site, `${period}-10`);
    db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, store_status, requested_by) VALUES (?, ?, 'Viaduct store', 'SITE_STORE', ?, ?, 'ACTIVE', 'e2e')").run(company, `MTR-ST-${sfx}`, project, site);
    db.prepare("INSERT INTO att_period_locks (company_id, period_start, period_end, status, locked_at, locked_by) VALUES (?, ?, ?, 'LOCKED', CURRENT_TIMESTAMP, 'hr')").run(company, from, to);
    db.prepare("INSERT INTO bill_cvr_reports (company_id, doc_no, org_project_id, period, as_of, status, margin_paise, margin_bp) VALUES (?, ?, ?, ?, ?, 'APPROVED', 1500000000, 1250)").run(company, `CVR-MC-${sfx}`, project, period, to);
    const head = Number(db.prepare("INSERT INTO fin_cost_heads (company_id, code, name) VALUES (?, 'MAT', 'Materials')").run(company).lastInsertRowid);
    const head2 = Number(db.prepare("INSERT INTO fin_cost_heads (company_id, code, name) VALUES (?, 'LAB', 'Labour')").run(company).lastInsertRowid);
    const c1 = Number(db.prepare("INSERT INTO fin_cost_codes (company_id, code, name, cost_head_id) VALUES (?, 'MAT-01', 'Cement and steel', ?)").run(company, head).lastInsertRowid);
    const c2 = Number(db.prepare("INSERT INTO fin_cost_codes (company_id, code, name, cost_head_id) VALUES (?, 'LAB-01', 'Labour gangs', ?)").run(company, head2).lastInsertRowid);
    const fc = Number(db.prepare("INSERT INTO fc_forecasts (company_id, doc_no, org_project_id, period, version_no, eac_total_paise, status) VALUES (?, ?, ?, ?, 1, 0, 'APPROVED')").run(company, `FC-MC-${sfx}`, project, period).lastInsertRowid);
    const line = db.prepare('INSERT INTO fc_forecast_lines (company_id, forecast_id, cost_code_id, line_label, budget_paise, committed_paise, actual_paise, eac_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    line.run(company, fc, c1, 'Materials', 1_500_000_00, 800_000_00, 600_000_00, 1_560_000_00);
    line.run(company, fc, c2, 'Labour', 300_000_00, 0, 120_000_00, 310_000_00);
    const cp = db.prepare('SELECT id FROM core_periods WHERE company_id = ? AND start_date = ?').get(company, from);
    db.prepare("INSERT INTO close_periods (company_id, doc_no, period_id, period, status, close_state) VALUES (?, ?, ?, ?, 'APPROVED', 'CLOSED')").run(company, `CL-MC-${sfx}`, cp.id, period);
  } finally {
    db.close();
  }

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 422/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: user('PCMGR'), roles: 'PCMGR', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // the board: start the close of the project from its card
  await page.goto(`/bi/monthly-close?period=${period}`);
  await expect(page.getByRole('heading', { name: 'Monthly Close Status', level: 1 })).toBeVisible();
  if (phone) await page.getByTestId('mc-column-switcher').getByRole('tab', { name: /Not started/ }).click();
  const card = page.locator('[data-testid="mc-card"][data-project="MTR-01"]');
  await card.getByRole('button', { name: 'Start the close' }).click();
  await expect(page.getByTestId('mc-moved')).toContainText('MTR-01');
  if (phone) await page.getByTestId('mc-column-switcher').getByRole('tab', { name: /Preparing/ }).click();
  await expect(card).toHaveAttribute('data-column', 'PREPARING');
  await expect(card).toContainText('Open: Material reconciliation approved');
  await expect(card.getByRole('button', { name: 'Send for approval' })).toBeDisabled();
  if (phone) {
    const visible = await page.locator('[data-testid="mc-board"] > section').evaluateAll((cols) => cols.filter((c) => getComputedStyle(c).display !== 'none').length);
    expect(visible, 'one column at a time on a phone').toBe(1);
  }
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.07/${phone ? 'mobile' : 'desktop'}-monthly-close-status.png`, fullPage: true });
  await checkAppearance(page);

  // the stores reconcile; the close is sent from its record
  const db2 = new DatabaseSync('data/e2e.sqlite');
  db2.exec('PRAGMA busy_timeout = 8000;');
  try { db2.prepare("INSERT INTO mrc_reconciliations (company_id, doc_no, org_project_id, org_site_id, period, period_start, period_end, requested_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'stores', 'APPROVED')").run(company, `MRC-${sfx}`, project, site, period, from, to); } finally { db2.close(); }
  await card.getByRole('link', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: /Project Monthly Close · MTR-01/ })).toBeVisible();
  await expect(page.locator('[data-testid="mc-step"][data-code="MATERIAL_RECON"]')).toHaveAttribute('data-state', 'PASS');
  await page.getByTestId('mc-submit').click();
  await expect(page.getByTestId('mc-frozen')).toContainText('Figures frozen');

  // QS → PM → PD through the workflow engine
  const closeId = Number(new URL(page.url()).searchParams.get('id'));
  const detail = await (await request.get(`/api/v1/bi/monthly-closes/${closeId}`, { headers: headers('PCMGR', company) })).json();
  expect(detail.data.status).toBe('SUBMITTED');
  for (const r of ['QS', 'PM', 'PD']) {
    const tasks = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: headers(r, company) })).json()).data.rows;
    const task = tasks.find((x) => x.instance?.docType === 'BI_MONTHLY_CLOSE' || x.instance?.doc_type === 'BI_MONTHLY_CLOSE') ?? tasks[0];
    expect(task, `${r} has the approval task`).toBeTruthy();
    const res = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: headers(r, company), data: { action: 'approve', comment: 'Checked against the source records' } });
    expect(res.status(), await res.text()).toBe(200);
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: /Project Monthly Close · MTR-01/ })).toBeVisible();
  await expect(page.getByText(/Month locked/)).toBeVisible();
  await page.getByRole('tab', { name: 'Project MIS' }).click();
  await expect(page.getByTestId('mc-mis')).toContainText('Margin');
  await noOverflow();
  await page.getByRole('tab', { name: 'Budget Master' }).click();
  await expect(page.getByTestId('mc-budget-row')).toHaveCount(2);
  await expect(page.locator('[data-testid="mc-budget-row"][data-head="MAT"]')).toContainText('15,60,000');
  if (phone) expect(await page.getByTestId('mc-budget-row').first().evaluate((row) => getComputedStyle(row).display)).not.toBe('table-row');
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  expect(file.suggestedFilename()).toBe(`budget-master-MTR-01-${period}.xlsx`);
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.07/${phone ? 'mobile' : 'desktop'}-project-monthly-close.png`, fullPage: true });
  await checkAppearance(page);
  expect(errors).toEqual([]);
});
