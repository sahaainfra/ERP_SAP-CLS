import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { todayIST } from '../src/shared/dates.js';

// Part 27.04 (T-UI-01, T-UI-02, AC-01, AC-07): the enterprise control tower on a 1280 px desktop and a 360 px phone — certified tiles, the health
// matrix and its drill to the project and its source records, the early warnings raised by the checks and settled from the worklist, the
// maker-checker settings; no horizontal scroll, lists as cards on the phone, no clipped labels at larger text in the dark and high-contrast themes.

async function checkAppearance(page) {
  const originalTheme = await page.locator('html').getAttribute('data-theme') ?? 'light';
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main button, main .kpi-label, main .kpi-value')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.removeProperty('font-size');
  }, originalTheme);
}

const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shift = (ym, n) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };

test('Enterprise control tower: executive dashboard, health matrix, drill-down and early warnings on desktop and phone', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const director = `ct-director-${suffix}`;
  const headers = (roles, company, user = director) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1), data: { code: `CT-${suffix.toUpperCase()}`, legalName: 'Tower Demo Infrastructure', shortName: 'Tower Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  const settings = await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company), data: { legalName: 'Tower Demo Infrastructure', reason: 'Set up the control tower fixture' } });
  expect(settings.ok(), await settings.text()).toBe(true);

  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  const today = todayIST();
  const last = shift(today.slice(0, 7), -1);
  const prior = shift(today.slice(0, 7), -2);
  let projects;
  try {
    for (const [user, role] of [[director, 'DIR'], [`ct-cfo-${suffix}`, 'CFO'], [`ct-pcm-${suffix}`, 'PCMGR'], [`ct-pm-${suffix}`, 'PM']]) {
      db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, user, user, JSON.stringify([role]));
    }
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Control tower browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2704', 'ff.site.p1405', 'ff.fin.p2311', 'ff.fin.p2312']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate');
    gate.run(company, 'G2', 'Workforce Gate');
    const region = Number(db.prepare("INSERT INTO org_branches (company_id, kind, code, name) VALUES (?, 'REGION', 'SOUTH', 'South region')").run(company).lastInsertRowid);
    const addProject = (code, name, sector, branch) => {
      const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, branch_id) VALUES (?, ?, ?, 'ROAD', 'ACTIVE', ?)").run(company, code, name, branch).lastInsertRowid);
      db.prepare("INSERT INTO proj_projects (company_id, project_id, status, lifecycle_state, sector, pm_user) VALUES (?, ?, 'APPROVED', 'EXECUTION', ?, ?)").run(company, id, sector, `ct-pm-${suffix}`);
      return id;
    };
    projects = { ring: addProject('RING-01', 'Outer ring road package 1', 'ROADS', region), tower: addProject('TWR-02', 'Hospital tower block', 'BUILDINGS', null) };
    const period = db.prepare("INSERT INTO prs_periods (company_id, doc_no, org_project_id, period_type, period_start, period_end, status) VALUES (?, ?, ?, 'MONTH', ?, ?, 'APPROVED')");
    const evm = db.prepare('INSERT INTO prs_evm (company_id, org_project_id, period_id, period_end, spi, cpi) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [doc, id, spi, cpi] of [['CT-PR-1', projects.ring, 8200, 9400], ['CT-PR-2', projects.tower, 9800, 9900]]) {
      const row = period.run(company, doc, id, `${last}-01`, monthEnd(last));
      evm.run(company, id, row.lastInsertRowid, monthEnd(last), spi, cpi);
    }
    const forecast = db.prepare("INSERT INTO fc_forecasts (company_id, doc_no, org_project_id, period, version_no, eac_total_paise, status) VALUES (?, ?, ?, ?, 1, ?, 'APPROVED')");
    forecast.run(company, 'CT-FC-1', projects.ring, last, 48_500_000_000);
    forecast.run(company, 'CT-FC-2', projects.tower, last, 21_000_000_000);
    const pl = db.prepare("INSERT INTO pl_snapshots (company_id, doc_no, org_project_id, period, revenue_paise, gross_profit_paise, revenue_cum_paise, status, frozen_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?)");
    pl.run(company, 'CT-PL-1', projects.ring, last, 1_200_000_000, 180_000_000, 18_400_000_000, `${today}T00:00:00Z`);
    pl.run(company, 'CT-PL-2', projects.tower, last, 900_000_000, 162_000_000, 7_600_000_000, `${today}T00:00:00Z`);
    const refresh = db.prepare("INSERT INTO bi_domain_refreshes (company_id, metric_code, dataset_version, period, captured_at, row_count, created_by) VALUES (?, ?, 1, ?, ?, 1, 'e2e')");
    const observe = db.prepare("INSERT INTO bi_domain_observations (company_id, refresh_id, project_id, value_scaled, source_period, source_version, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, 1, 'e2e', ?, '0')");
    observe.run(company, refresh.run(company, 'spi', last, `${last}-02T00:30:00Z`).lastInsertRowid, projects.ring, 8600, monthEnd(prior), 'prs_periods');
    observe.run(company, refresh.run(company, 'eac', last, `${last}-02T00:30:00Z`).lastInsertRowid, projects.ring, 44_000_000_000, prior, 'fc_forecasts');
  } finally {
    db.close();
  }
  // certify the metrics behind the tiles: the project controls manager asks, the CFO approves (27.03)
  for (const code of ['spi', 'cpi', 'eac', 'gross-margin', 'revenue-to-date']) {
    const asked = await request.post('/api/v1/bi/metrics/certifications', { headers: headers('PCMGR', company, `ct-pcm-${suffix}`), data: { code, certify: true, reason: 'Checked against the approved source' } });
    expect(asked.status(), await asked.text()).toBe(201);
    const { id, version } = (await asked.json()).data;
    const decided = await request.post(`/api/v1/bi/metrics/certifications/${id}/act`, { headers: headers('CFO', company, `ct-cfo-${suffix}`), data: { action: 'approve', version } });
    expect(decided.status(), await decided.text()).toBe(200);
  }
  // the early-warning checks run as a background job
  const queued = await request.post('/api/v1/bi/exec-alerts/evaluations', { headers: headers('DIR', company), data: {} });
  expect(queued.status(), await queued.text()).toBe(202);
  await expect.poll(async () => (await (await request.get('/api/v1/bi/exec-alerts?status=ACTIVE', { headers: headers('DIR', company) })).json()).data.total, { timeout: 20_000 }).toBe(2);

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

  // the executive dashboard: hero KPI first, certified tiles with the last refresh, health chart, alerts, pending actions
  await page.goto('/bi/control-tower');
  await expect(page.getByRole('heading', { name: 'Enterprise Control Tower', level: 1 })).toBeVisible();
  await expect(page.getByText(/certified metrics evaluated/)).toBeVisible();
  const tiles = page.getByTestId('ct-tiles');
  await expect(tiles.getByTestId('ct-project-count')).toContainText('2');
  await expect(tiles.locator('.kpi-tile').first()).toHaveAttribute('data-testid', 'ct-tile-eac');
  await expect(page.getByTestId('ct-tile-eac-value')).toContainText('69.50 Cr');
  await expect(page.getByTestId('ct-tile-spi-value')).toHaveText('0.90');
  await expect(page.getByTestId('ct-tile-revenue')).toContainText('Certified · 2 project(s)');
  await expect(page.getByTestId('ct-tile-dso')).toContainText(/Awaiting certification|Source not enabled/);
  await expect(page.getByTestId('ct-card-alerts').getByTestId('ct-alert-row')).toHaveCount(2);
  await expect(page.getByTestId('ct-card-pending')).toBeVisible();
  const chart = page.getByTestId('ct-card-health').locator('svg').first();
  await expect(chart).toBeVisible();
  expect((await chart.boundingBox()).height).toBeGreaterThanOrEqual(phone ? 220 : 150);
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.04/${phone ? 'mobile' : 'desktop'}-enterprise-control-tower.png`, fullPage: true });
  await checkAppearance(page);
  await checkWidths();
  await page.goto('/bi/control-tower?sector=BUILDINGS');
  await expect(page.getByTestId('ct-project-count')).toContainText('1');
  await page.getByTestId('ct-project-count').getByRole('link').click();
  await expect(page).toHaveURL(/sector=BUILDINGS.*tab=matrix/);
  await expect(page.getByTestId('ct-matrix-row')).toHaveCount(1);
  await page.goto('/bi/control-tower');

  // the hero tile opens the health matrix; a filter narrows it; a project row opens the project with its source records
  await page.getByTestId('ct-tile-eac').getByRole('link').click();
  await expect(page.getByTestId('ct-matrix')).toBeVisible();
  await expect(page.getByTestId('ct-matrix-row')).toHaveCount(2);
  await expect(page.locator('[data-testid="ct-matrix-row"][data-code="RING-01"]')).toHaveAttribute('data-overall', 'RED');
  await page.getByLabel('Sector').selectOption('BUILDINGS');
  await expect(page.getByTestId('ct-matrix-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page.getByTestId('ct-matrix-row')).toHaveCount(2);
  if (phone) {
    const display = await page.getByTestId('ct-matrix-row').first().evaluate((row) => getComputedStyle(row).display);
    expect(display, 'the matrix is a list of cards on a phone').not.toBe('table-row');
  }
  await page.getByRole('button', { name: 'Open RING-01' }).click();
  const drill = page.getByTestId('ct-drill');
  await expect(drill.getByRole('heading', { name: /RING-01/ })).toBeVisible();
  await expect(drill.getByTestId('ct-drill-metrics').locator('[data-code="spi"]').getByRole('link')).toHaveAttribute('href', /\/site\/periods\?id=\d+/);
  await expect(drill.getByRole('link', { name: 'Open Project 360' })).toHaveAttribute('href', `/proj/project-360?projectId=${projects.ring}`);
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.04/${phone ? 'mobile' : 'desktop'}-health-matrix-drill.png`, fullPage: true });

  // the worklist: acknowledge one alert, resolve the other with a note
  await page.getByRole('tab', { name: /Executive alerts/ }).click();
  await expect(page.getByTestId('ct-alerts').getByTestId('ct-alert-row')).toHaveCount(2);
  const spiRow = page.locator('[data-testid="ct-alert-row"][data-rule="SPI_LOW"]');
  await spiRow.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(spiRow).toHaveAttribute('data-status', 'ACKNOWLEDGED');
  const eacRow = page.locator('[data-testid="ct-alert-row"][data-rule="EAC_GROWTH"]');
  await eacRow.getByRole('button', { name: 'Resolve' }).click();
  await eacRow.getByLabel('Resolution note').fill('Client approved variation VO-12 covering the growth');
  await eacRow.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('[data-testid="ct-alert-row"][data-rule="EAC_GROWTH"]')).toHaveCount(0);
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/27.04/${phone ? 'mobile' : 'desktop'}-executive-alerts.png`, fullPage: true });

  // the settings: a director proposes a change; it waits for another approver
  await page.getByRole('tab', { name: 'Early-warning settings' }).click();
  await page.locator('[data-testid="ct-settings"] tr[data-code="COLLECTIONS_OVERDUE"]').getByRole('button', { name: 'Propose a change' }).click();
  await page.getByLabel('Threshold').fill('75');
  await page.getByLabel('Reason for the change').fill('Board asked for earlier collection warnings');
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByTestId('ct-settings-pending').getByText('Early warning: Collections overdue')).toBeVisible();
  await expect(page.getByTestId('ct-settings-pending').getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/27.04/${phone ? 'mobile' : 'desktop'}-early-warning-settings.png`, fullPage: true });
  expect(errors).toEqual([]);
});
