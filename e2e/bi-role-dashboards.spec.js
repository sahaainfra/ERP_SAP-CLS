import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 27.10 (T-01, T-UI-01, T-UI-02, FR-04): every role of the catalogue opens its role dashboard on a 360 px phone (and a set of roles on a
// 1280 px desktop) with its cards loaded and no error card, no horizontal scroll and no console errors; the Dashboard Inventory shows every
// widget, the role coverage and a clean scan, on desktop and phone.

const ROLES = ['SYSADM', 'ITADM', 'DIR', 'CFO', 'ACCMGR', 'PROCMGR', 'COMMGR', 'HRMGR', 'QCMGR', 'PCMGR', 'PD', 'PM', 'CM', 'SE', 'CSUP', 'WSUP', 'PMSUP', 'SK', 'PROCIC', 'SACC',
  'QCE', 'HSEE', 'SUBCO', 'SUPADM', 'AUD', 'BD', 'EST', 'QS', 'PLAN', 'DOC', 'DESIGN', 'FINEX', 'PAY', 'HSEO', 'SECMGR', 'SECSUP', 'GUARD', 'PLANTMGR', 'STOREMGR', 'EMP'];
const DESKTOP = ['DIR', 'PM', 'SE', 'SK', 'ACCMGR', 'HSEE'];

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

async function company(request, suffix) {
  const headers = (roles, c) => ({ 'x-erp-roles': roles, 'x-erp-company': String(c), 'x-erp-user': 'rd-setup', 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1), data: { code: `RD-${suffix}`, legalName: 'Role Dashboard Demo Infrastructure', shortName: 'Role Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', id), data: { legalName: 'Role Dashboard Demo Infrastructure', reason: 'Set up the role dashboard fixture' } })).ok()).toBe(true);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Role dashboard browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2710']) flag.run(code, id);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(id, 'G1', 'Platform Gate'); gate.run(id, 'G2', 'Workforce Gate');
    const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'MET-03', 'Metro depot package 3', 'BUILDING', 'ACTIVE')").run(id).lastInsertRowid);
    db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, 'MET-S1', 'Depot yard', 'ACTIVE')").run(id, project);
    for (const role of ROLES) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(id, `rd-${role.toLowerCase()}-${suffix}`, `${role} user`, JSON.stringify([role]));
  } finally {
    db.close();
  }
  return id;
}

test('Every role opens its role dashboard with its cards loaded', async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'M' : 'D';
  const id = await company(request, suffix);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 403/.test(message.text())) errors.push(message.text()); });
  for (const role of phone ? ROLES : DESKTOP) {
    await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: `rd-${role.toLowerCase()}-${suffix}`, roles: role, company: String(id) });
    await page.goto('/bi/role-dashboard');
    await expect(page.getByRole('heading', { name: 'My Role Dashboard', level: 1 }), role).toBeVisible();
    const dash = page.getByTestId('dashboard');
    await expect(dash, role).toHaveAttribute('data-source', 'role');
    const cards = dash.locator('[data-testid^="widget-"][data-widget]');
    expect(await cards.count(), `${role} has cards`).toBeGreaterThanOrEqual(2);
    await expect(dash.getByText(/could not be loaded/), `${role}: no card fails`).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${role} overflow` }).toBeLessThanOrEqual(0);
    if (role === 'PM') {
      await page.screenshot({ path: `docs/erp/screenshots/27.10/${phone ? 'mobile' : 'desktop'}-role-dashboards-for-every-role-in-06-rol.png`, fullPage: true });
      await checkAppearance(page);
    }
  }
  expect(errors).toEqual([]);
});

test('Dashboard Inventory: widgets, role coverage, dashboards and a clean scan', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'IM' : 'ID';
  const id = await company(request, suffix);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: `rd-sysadm-${suffix}`, roles: 'SYSADM', company: String(id) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.goto('/bi/dashboard-inventory');
  await expect(page.getByRole('heading', { name: 'Dashboard Inventory', level: 1 })).toBeVisible();
  await expect(page.getByTestId('inv-chart')).toBeVisible();
  await expect(page.getByTestId('inv-scan')).toContainText('0');
  expect(await page.getByTestId('inv-widget-row').count()).toBeGreaterThan(100);
  await expect(page.locator('[data-testid="inv-widget-row"][data-code="hse.ltifr"]')).toContainText('Retired');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/27.10/${phone ? 'mobile' : 'desktop'}-dashboard-inventory.png`, fullPage: false });
  await checkAppearance(page);
  await page.getByTestId('inv-views').getByRole('tab', { name: 'Role coverage' }).click();
  await expect(page.getByTestId('inv-role-row').filter({ hasText: 'SE' }).first()).toBeVisible();
  await expect(page.getByTestId('inv-roles')).toContainText(/(\d+) \/ \1/);
  await noOverflow();
  await page.getByTestId('inv-views').getByRole('tab', { name: 'Dashboards' }).click();
  await expect(page.getByTestId('inv-dashboards')).toContainText('role-dashboard');
  await page.getByTestId('inv-rescan').click();
  await expect(page.getByTestId('inv-scan-card')).toContainText('No hard-coded figures');
  expect(errors).toEqual([]);
});
