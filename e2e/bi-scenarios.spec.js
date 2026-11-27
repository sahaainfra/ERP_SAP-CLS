import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { todayIST } from '../src/shared/dates.js';

// Part 27.11 (AC-01, T-UI-01, T-UI-02): the Scenario Builder on a 1280 px desktop and a 360 px phone — scope, drivers and live results (EAC from
// the approved forecast, completion from a recalculated copy of the schedule), save, then compare two saved scenarios side by side; the live
// forecast is unchanged; no horizontal scroll, no clipped labels at larger text, no console errors.

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

test('Scenario Builder: drivers, live impact, save and compare without touching live data', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const cfo = `scn-cfo-${suffix}`;
  const headers = (roles, company, user = cfo) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1), data: { code: `SCN-${suffix.toUpperCase()}`, legalName: 'Scenario Demo Infrastructure', shortName: 'Scenario Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company), data: { legalName: 'Scenario Demo Infrastructure', reason: 'Set up the scenario fixture' } })).ok()).toBe(true);
  const today = todayIST();
  let project; let forecastEac;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, cfo, cfo, '["CFO"]');
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Scenario browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2711']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'BRG-04', 'River bridge package 4', 'BRIDGE', 'ACTIVE')").run(company).lastInsertRowid);
    const head = Number(db.prepare("INSERT INTO fin_cost_heads (company_id, code, name) VALUES (?, 'STL', 'Steel')").run(company).lastInsertRowid);
    const code = Number(db.prepare("INSERT INTO fin_cost_codes (company_id, code, name, cost_head_id) VALUES (?, 'STL-01', 'Reinforcement steel', ?)").run(company, head).lastInsertRowid);
    const fc = Number(db.prepare("INSERT INTO fc_forecasts (company_id, doc_no, org_project_id, period, version_no, eac_total_paise, contract_revenue_paise, status) VALUES (?, 'FC-BRG', ?, ?, 1, 4500000000, 5200000000, 'APPROVED')").run(company, project, today.slice(0, 7)).lastInsertRowid);
    db.prepare("INSERT INTO fc_forecast_lines (company_id, forecast_id, cost_code_id, line_label, budget_paise, budget_qty_milli, actual_paise, actual_qty_milli, etc_method, remaining_qty_milli, rate_x100, etc_paise, eac_paise) VALUES (?, ?, ?, 'Reinforcement steel', 1800000000, 300000, 900000000, 150000, 'BOTTOM_UP', 150000, 6000000, 900000000, 1800000000)").run(company, fc, code);
    const cal = Number(db.prepare("INSERT INTO plan_calendars (company_id, code, name) VALUES (?, 'BRG-CAL', 'Six-day week')").run(company).lastInsertRowid);
    const sch = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, calendar_id, start_date, status) VALUES (?, 'SCH-BRG', ?, ?, 'Master', ?, ?, 'APPROVED')").run(company, today, project, cal, today).lastInsertRowid);
    const act = (c, n, d) => Number(db.prepare('INSERT INTO plan_activities (company_id, schedule_id, code, name, duration_days) VALUES (?, ?, ?, ?, ?)').run(company, sch, c, n, d).lastInsertRowid);
    const piles = act('P10', 'Piling', 30); const caps = act('P20', 'Pile caps', 15); const deck = act('D10', 'Deck slab', 25);
    const dep = db.prepare("INSERT INTO plan_dependencies (company_id, schedule_id, pred_id, succ_id, dep_type, lag_days) VALUES (?, ?, ?, ?, 'FS', 0)");
    dep.run(company, sch, piles, caps); dep.run(company, sch, caps, deck);
    forecastEac = db.prepare('SELECT eac_total_paise AS v FROM fc_forecasts WHERE id = ?').get(fc).v;
  } finally {
    db.close();
  }

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: cfo, roles: 'CFO', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.goto('/bi/scenarios');
  await expect(page.getByRole('heading', { name: 'Scenario Builder', level: 1 })).toBeVisible();
  // step 1: scope
  await page.getByLabel('Scenario name *').fill('Steel up 10 %');
  await page.getByLabel('Project *').selectOption(String(project));
  // the default driver is steel +10 %: 150 t to go × ₹60,000 × 10 % = ₹9,00,000
  await expect(page.getByTestId('scn-sticky').getByTestId('scn-eac')).toContainText('9,00,000');
  // PACK-W0-01: the calendar days a 10-working-day delay adds depend on the weekday of the finish (one or two Sundays crossed), and the
  // seeded finish moves with today's date; the expectation is worked out from the finish shown before the delay, as the server does
  const before = (await page.getByTestId('scn-sticky').getByTestId('scn-finish').textContent()).match(/(\d{2})-([A-Za-z]{3})-(\d{4})/);
  expect(before, 'the completion date is shown before the delay').not.toBeNull();
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const finish = new Date(Date.UTC(Number(before[3]), MON.indexOf(before[2]), Number(before[1])));
  let calendarDays = 0; for (let work = 0; work < 10;) { calendarDays += 1; if (new Date(finish.getTime() + calendarDays * 86_400_000).getUTCDay() !== 0) work += 1; }
  await page.getByTestId('scn-scope').getByRole('button', { name: 'Next' }).click();
  // step 2: add a schedule delay on the pile caps
  await page.getByTestId('scn-add').click();
  const second = page.getByTestId('scn-driver').nth(1);
  await second.getByLabel('Activity code').fill('P20');
  await second.getByLabel('Days *').fill('10');
  await expect(page.getByTestId('scn-sticky').getByTestId('scn-finish')).toContainText(`${calendarDays} days later`); // 10 working days of a six-day week
  await page.getByTestId('scn-drivers').getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('scn-lines')).toContainText('Reinforcement steel');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/27.11/${phone ? 'mobile' : 'desktop'}-scenario-builder.png`, fullPage: true });
  await checkAppearance(page);
  await page.getByTestId('scn-save').click();
  await expect(page.getByTestId('scn-record')).toContainText('Steel up 10 %');
  // a second scenario through the API, then compare
  const second2 = await request.post('/api/v1/bi/scenarios', { headers: headers('CFO', company), data: { name: 'Wages and late collections', projectId: project, save: true, drivers: [{ type: 'WAGE_RATE', pct: 8 }, { type: 'MATERIAL_PRICE', match: 'steel', pct: 5 }] } });
  expect(second2.status(), await second2.text()).toBe(201);
  await page.goto('/bi/scenarios?tab=saved');
  await expect(page.getByTestId('scn-row')).toHaveCount(2);
  for (const row of await page.getByTestId('scn-row').all()) await row.getByRole('checkbox').check();
  await page.getByTestId('scn-compare').click();
  await expect(page.getByRole('heading', { name: 'Scenario Comparison', level: 1 })).toBeVisible();
  await expect(page.getByTestId('scn-compare-table')).toContainText('Wages and late collections');
  await noOverflow();
  if (!phone) await page.screenshot({ path: 'docs/erp/screenshots/27.11/desktop-scenario-comparison.png', fullPage: true });
  // BR-01: the live forecast is unchanged
  const check = new DatabaseSync('data/e2e.sqlite');
  try { expect(check.prepare('SELECT eac_total_paise AS v FROM fc_forecasts WHERE org_project_id = ?').get(project).v).toBe(forecastEac); } finally { check.close(); }
  expect(errors).toEqual([]);
});
