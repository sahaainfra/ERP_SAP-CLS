import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { todayIST } from '../src/shared/dates.js';

// Part 27.08 (AC-01, T-UI): the Variance Explainer on a 1280 px desktop and a 360 px phone — the "Why?" waterfall and contributors whose rows
// add up, with the residual shown, to the total; the margin bridge; the drill-down from the company through the project and its WBS to a
// transaction with the breadcrumb; no horizontal scroll, no clipped labels at larger text in the dark and high-contrast themes, no console errors.

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

test('Variance Explainer: Why? waterfall, contributors, margin bridge and drill-down on desktop and phone', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const director = `why-director-${suffix}`;
  const headers = (roles, company, user = director) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1), data: { code: `WHY-${suffix.toUpperCase()}`, legalName: 'Explainer Demo Infrastructure', shortName: 'Explainer Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company), data: { legalName: 'Explainer Demo Infrastructure', reason: 'Set up the explainer fixture' } })).ok()).toBe(true);
  const today = todayIST();
  let project;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, director, director, '["DIR"]');
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Explainer browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2708']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'MTR-02', 'Metro viaduct package 2', 'ROAD', 'ACTIVE')").run(company).lastInsertRowid);
    db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, 'MTR-S1', 'Depot site', 'ACTIVE')").run(company, project);
    const wbs = (code, name) => Number(db.prepare('INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, ?, ?, 1, ?)').run(company, project, code, name, 'e2e').lastInsertRowid);
    const w1 = wbs('1', 'Foundations'); const w2 = wbs('2', 'Superstructure');
    const [c1, c2, c3] = db.prepare('SELECT id FROM fin_cost_codes ORDER BY id LIMIT 3').all().map((x) => x.id);
    // the control facts (14.07): material, labour and plant against budget, and an unbudgeted variation
    const fact = db.prepare('INSERT INTO ctl_facts (company_id, org_project_id, wbs_id, cost_code_id, resource_type, budget_qty, budget_cost, planned_cost, earned_cost, actual_qty, actual_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    fact.run(company, project, w1, c1, 'MATERIAL', 600_000, 60_000_000, 35_000_000, 30_000_000, 200_000, 13_000_000);
    fact.run(company, project, w2, c2, 'LABOUR', 400_000, 40_000_000, 20_000_000, 8_000_000, 100_000, 12_000_000);
    fact.run(company, project, w2, c3, 'EQUIPMENT', 100_000, 10_000_000, 3_000_000, 2_000_000, 30_000, 3_600_000);
    fact.run(company, project, w1, c2, 'OTHER', 0, 0, 0, 0, 1_000, 2_500_000);
    const actual = db.prepare("INSERT INTO bud_actuals (company_id, org_project_id, wbs_id, cost_code_id, resource_type, doc_ref, vendor_name, description, qty, amount, actual_date, status, src_type, src_id, src_line_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, '1')");
    actual.run(company, project, w1, c1, 'MATERIAL', 'GRN-2041', 'Shree Cement Traders', 'M35 concrete', 200_000, 13_000_000, today, 'GRN_DIRECT', 'GRN-2041');
    actual.run(company, project, w2, c2, 'LABOUR', 'WR-0911', 'Labour gangs', 'Wage run', 100_000, 12_000_000, today, 'WAGE', 'WR-0911');
    actual.run(company, project, w2, c3, 'EQUIPMENT', 'PL-0332', 'Crane hire', 'Crane log', 30_000, 3_600_000, today, 'PLANT_LOG', 'PL-0332');
    actual.run(company, project, w1, c2, 'OTHER', 'VO-0007', 'Shree Traders', 'Extra dewatering', 1_000, 2_500_000, today, 'AP_BILL', 'VO-0007');
    // two approved CVRs (22.09) for the margin bridge
    const cvr = db.prepare("INSERT INTO bill_cvr_reports (company_id, doc_no, org_project_id, period, as_of, status, value_paise, cost_paise, margin_paise, margin_bp, value_lines_json, expense_lines_json) VALUES (?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?, ?)");
    const lines = (o) => JSON.stringify(Object.entries(o).map(([key, [label, amount]]) => ({ key, label, amount })));
    cvr.run(company, 'CVR/W1', project, '2026-09', '2026-09-30', 10_000_000, 8_500_000, 1_500_000, 1500, lines({ CERTIFIED: ['Certified work', 9_000_000], WIP: ['Work in progress', 1_000_000] }), lines({ MATERIAL: ['Material', 5_000_000], LABOUR: ['Labour', 3_500_000] }));
    cvr.run(company, 'CVR/W2', project, '2026-10', '2026-10-31', 13_000_000, 11_800_000, 1_200_000, 923, lines({ CERTIFIED: ['Certified work', 11_500_000], WIP: ['Work in progress', 1_200_000], VARIATION: ['Approved variations', 300_000] }), lines({ MATERIAL: ['Material', 7_000_000], LABOUR: ['Labour', 4_000_000], PLANT: ['Plant', 800_000] }));
  } finally {
    db.close();
  }
  const api = await request.get(`/api/v1/bi/explain/why?projectId=${project}`, { headers: headers('DIR', company) });
  expect(api.status(), await api.text()).toBe(200);
  const w = (await api.json()).data;
  expect(Math.round((w.components.reduce((n, c) => n + c.amount, 0) + w.residual) * 100) / 100).toBe(w.total);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: director, roles: 'DIR', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // Why? — cost
  await page.goto(`/bi/explain?projectId=${project}`);
  await expect(page.getByRole('heading', { name: 'Variance Explainer', level: 1 })).toBeVisible();
  await expect(page.getByTestId('why-waterfall')).toBeVisible();
  await expect(page.getByTestId('why-row')).toHaveCount(w.components.length);
  await expect(page.getByTestId('why-row').filter({ hasText: 'Material quantity' })).toBeVisible();
  await expect(page.getByTestId('why-row').filter({ hasText: 'Scope / variations' })).toBeVisible();
  await expect(page.getByTestId('why-residual-row')).toBeVisible();
  await expect(page.getByTestId('why-total-row')).toContainText('add up to the total');
  await expect(page.getByTestId('why-method')).toContainText('Deterministic');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/27.08/${phone ? 'mobile' : 'desktop'}-variance-explainer.png`, fullPage: true });
  await checkAppearance(page);

  // the margin bridge
  await page.getByTestId('why-kpis').getByRole('tab', { name: 'Margin' }).click();
  await expect(page.getByTestId('why-row').filter({ hasText: 'Cost: Plant' })).toBeVisible();
  await expect(page.getByTestId('why-row').filter({ hasText: 'Value: Approved variations' })).toBeVisible();
  await expect(page.getByTestId('why-total-value')).toContainText('3,000');
  await noOverflow();

  // the drill-down: company → project → WBS → transaction, with the breadcrumb
  await page.getByTestId('why-tabs').getByRole('tab', { name: 'Drill-down' }).click();
  const crumbs = page.getByTestId('drill-breadcrumb');
  await expect(crumbs.locator('li')).toHaveCount(2);
  await expect(crumbs).toContainText('MTR-02');
  await page.getByTestId('drill-child').filter({ hasText: 'Foundations' }).getByRole('link', { name: /Foundations/ }).click();
  await expect(crumbs.locator('li')).toHaveCount(3);
  await expect(crumbs.locator('li').last()).toHaveAttribute('data-level', 'wbs');
  await page.getByTestId('drill-child').filter({ hasText: 'GRN-2041' }).getByRole('link', { name: /GRN-2041/ }).click();
  await expect(crumbs.locator('li').last()).toHaveAttribute('data-level', 'txn');
  await expect(page.getByTestId('drill-child').first()).toBeVisible();
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/27.08/${phone ? 'mobile' : 'desktop'}-drill-down.png`, fullPage: true });
  await crumbs.getByRole('link', { name: /Company/ }).click();
  await expect(page.getByTestId('drill-child').filter({ hasText: 'MTR-02' })).toBeVisible();
  await checkAppearance(page);
  expect(errors).toEqual([]);
});
