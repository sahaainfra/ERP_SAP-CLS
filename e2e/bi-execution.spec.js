import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { todayIST } from '../src/shared/dates.js';

// Part 27.06 (T-UI-01, T-UI-02, AC-01, AC-07): daily execution intelligence and the work-done valuation on a 1280 px desktop and a 360 px phone —
// the hero tile is the day's work done at contract rates, the site comparison and the valuation are cards on a phone, the budget cost is hidden from
// a QS, no horizontal scroll, no clipped labels at larger text in the dark and high-contrast themes, no console errors.

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

test('Daily execution intelligence: work done, WIP, site comparison and valuation on desktop and phone', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const director = `ex-director-${suffix}`;
  const headers = (roles, company, user = director) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1), data: { code: `EX-${suffix.toUpperCase()}`, legalName: 'Execution Demo Infrastructure', shortName: 'Execution Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company), data: { legalName: 'Execution Demo Infrastructure', reason: 'Set up the execution fixture' } })).ok()).toBe(true);
  const today = todayIST();
  let project; let s1;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, director, director, '["DIR"]');
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Execution browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2706']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'ELV-01', 'Elevated corridor package 1', 'ROAD', 'ACTIVE')").run(company).lastInsertRowid);
    const site = (code, name) => Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, ?, 'ACTIVE')").run(company, project, code, name).lastInsertRowid);
    s1 = site('ELV-S1', 'Pier zone north'); const s2 = site('ELV-S2', 'Pier zone south');
    const version = Number(db.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status) VALUES (?, 'BOQ-E1', ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED')").run(company, project).lastInsertRowid);
    const line = (code, desc, uom, qty, rate) => Number(db.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount) VALUES (?, ?, 'ITEM', ?, ?, ?, ?, ?, 0)").run(company, version, code, desc, uom, qty, rate).lastInsertRowid);
    const concrete = line('3.1', 'M35 concrete in piers', 'm3', 2_000_000, 65_000_000); const steel = line('5.2', 'Reinforcement steel', 'kg', 200_000_000, 725_000);
    const calendar = Number(db.prepare("INSERT INTO plan_calendars (company_id, code, name) VALUES (?, 'ELV-CAL', 'Six-day week')").run(company).lastInsertRowid);
    const schedule = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, calendar_id, start_date) VALUES (?, 'SCH-E1', ?, ?, 'Master', ?, ?)").run(company, today, project, calendar, today).lastInsertRowid);
    const activity = (code, boq, qty) => { const id = Number(db.prepare('INSERT INTO plan_activities (company_id, schedule_id, code, name) VALUES (?, ?, ?, ?)').run(company, schedule, code, `${code} works`).lastInsertRowid); db.prepare('INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty) VALUES (?, ?, ?, ?)').run(company, id, boq, qty); return id; };
    const pier = activity('PIER', concrete, 2_000_000); const rebar = activity('REBAR', steel, 200_000_000);
    let wa = 0;
    const dpr = (siteId, items, labour, hours) => {
      const d = Number(db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status) VALUES (?, ?, ?, ?, ?, 'sup', 'APPROVED')").run(company, `DPR-${siteId}`, project, siteId, today).lastInsertRowid);
      for (const [act, qty, planned] of items) {
        wa += 1;
        const w = Number(db.prepare("INSERT INTO site_work_authorisations (company_id, wa_no, org_project_id, wa_site_id, plan_date, activity_id, planned_qty, start_time, end_time, supervisor, status) VALUES (?, ?, ?, ?, ?, ?, 1000, '08:00', '18:00', 'sup', 'APPROVED')").run(company, `WA-${suffix}-${wa}`, project, siteId, today, act).lastInsertRowid);
        db.prepare('INSERT INTO site_dpr_work (company_id, dpr_id, wa_id, activity_id, qty, planned_qty) VALUES (?, ?, ?, ?, ?, ?)').run(company, d, w, act, qty, planned);
      }
      db.prepare("INSERT INTO site_dpr_labour (company_id, dpr_id, category, trade_code, headcount, man_days) VALUES (?, ?, 'CONTRACT', 'MASON', ?, ?)").run(company, d, labour, labour * 1000);
      db.prepare("INSERT INTO site_dpr_equipment (company_id, dpr_id, equipment_key, label, hours_worked) VALUES (?, ?, 'TM-01', 'Transit mixer', ?)").run(company, d, hours);
    };
    dpr(s1, [[pier, 42_500, 50_000], [rebar, 3_200_000, 3_000_000]], 18, 7500);
    dpr(s2, [[pier, 10_000, 20_000]], 9, 4000);
  } finally {
    db.close();
  }
  const queued = await request.post('/api/v1/bi/execution/captures', { headers: headers('DIR', company), data: { date: today } });
  expect(queued.status(), await queued.text()).toBe(202);
  await expect.poll(async () => (await (await request.get(`/api/v1/bi/execution?date=${today}`, { headers: headers('DIR', company) })).json()).data.tiles.sitesReporting, { timeout: 20_000 }).toBe(2);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: director, roles: 'DIR', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.goto('/bi/execution');
  await expect(page.getByRole('heading', { name: 'Daily Execution Intelligence', level: 1 })).toBeVisible();
  await expect(page.getByText(/Approved DPRs of/)).toBeVisible();
  await expect(page.getByTestId('ex-tiles').locator('.kpi-tile').first()).toHaveAttribute('data-testid', 'ex-tile-executed');
  await expect(page.getByTestId('ex-executed')).toContainText('5.73 L'); // ₹2,76,250 + ₹2,32,000 + ₹65,000 = ₹5,73,250
  await expect(page.getByTestId('ex-site-row')).toHaveCount(2);
  if (phone) expect(await page.getByTestId('ex-site-row').first().evaluate((row) => getComputedStyle(row).display)).not.toBe('table-row');
  await expect(page.getByTestId('ex-card-exceptions')).toContainText('achieved 50% of plan');
  const chart = page.getByTestId('ex-card-trend').locator('svg').first();
  await expect(chart).toBeVisible();
  expect((await chart.boundingBox()).height).toBeGreaterThanOrEqual(phone ? 220 : 150);
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.06/${phone ? 'mobile' : 'desktop'}-daily-execution-intelligence.png`, fullPage: true });
  await checkAppearance(page);

  // the site opens its valuation: item × rate with the DPR behind it
  await page.getByTestId('ex-site-row').filter({ hasText: 'Pier zone north' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Work-Done & WIP Valuation', level: 1 })).toBeVisible();
  await expect(page.getByTestId('ex-valuation-row')).toHaveCount(2);
  await expect(page.locator('[data-testid="ex-valuation-row"][data-code="3.1"]')).toContainText('2,76,250');
  await expect(page.locator('[data-testid="ex-valuation-row"][data-code="3.1"]').getByRole('link')).toHaveAttribute('href', /\/site\/dprs\?id=\d+/);
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('ex-export').click()]);
  expect(file.suggestedFilename()).toBe(`work-done-${today}.xlsx`);
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.06/${phone ? 'mobile' : 'desktop'}-work-done-valuation.png`, fullPage: true });
  await checkAppearance(page);
  expect(errors).toEqual([]);
});
