import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 28.03 (AC-01, T-01, T-UI-01, T-UI-02): Forecasts & Anomalies on a 1280 px desktop and a 360 px phone — the procurement manager sees the
// official cement rate forecast (labelled, with its range, drivers and the kind of every point) from a model version they back-tested and the
// project controls manager approved; reviews the flagged purchase rate; and opens the back-testing report. No horizontal scroll, no clipped
// labels at larger text, no console errors.

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
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const monthsAgo = (k) => { const d = new Date(); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 10); };

test('Forecasts & Anomalies: official rate forecast with range and labels, anomaly review, and the back-testing report', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { sys: `af-sys-${suffix}`, proc: `af-proc-${suffix}`, pcm: `af-pcm-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `AFC-${suffix.toUpperCase()}`, legalName: 'Forecast Demo Infrastructure', shortName: 'Forecast Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company, 'setup'), data: { legalName: 'Forecast Demo Infrastructure', reason: 'Set up the forecast fixture' } })).ok()).toBe(true);
  let item;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['sys', 'SYSADM'], ['proc', 'PROCMGR'], ['pcm', 'PCMGR']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Forecast browser fixture', 0, 1)");
    for (const code of ['ff.ai.p2803', 'ff.proc.p1509']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'FC-07', 'Metro depot', 'BUILDING', 'ACTIVE')").run(company).lastInsertRowid);
    const cat = db.prepare("SELECT id FROM mdm_item_categories WHERE code = 'CEMENT'").get()?.id ?? 1;
    item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from) VALUES (?, 'CEM-OPC', 'OPC cement 53 grade', 'MATERIAL', ?, 'bag', '2024-01-01')").run(company, cat).lastInsertRowid);
    const obs = db.prepare("INSERT INTO rti_observations (company_id, item_id, region_code, obs_date, rate, uom, landed_rate, base_uom, base_landed_rate, source_type, source_id) VALUES (?, ?, 'TS', ?, ?, 'bag', ?, 'bag', ?, 'SURVEY', ?)");
    const ix = db.prepare("INSERT INTO rti_indices (company_id, index_group, region_code, period, index_value) VALUES (?, 'CEMENT', 'TS', ?, ?)");
    for (let k = 23; k >= 1; k -= 1) { const m = 23 - k; const r = 34_000 + 450 * m + (m % 4) * 60 + ((m % 3) - 1) * 40; obs.run(company, item, monthsAgo(k), r, r, r, `e2e-${k}`); ix.run(company, monthsAgo(k).slice(0, 7), Math.round((100 + m * 1.5 + (m % 4) * 0.7) * 10000)); }
    const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Shree Cement Traders Pvt Ltd', 'Shree', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `FC-V-${suffix}`).lastInsertRowid);
    const po = db.prepare(`INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, status, requested_by) VALUES (?, ?, ?, ?, ${vendor}, 'APPROVED', 'buyer')`);
    const line = db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, rate) VALUES (?, ?, 1, ?, 'OPC cement', 500, 'bag', ?)");
    for (let k = 0; k < 12; k += 1) line.run(company, Number(po.run(company, `PO-${suffix}-${k}`, day(100 - k * 5), project).lastInsertRowid), item, 38_000 + ((k % 5) - 2) * 300);
    line.run(company, Number(po.run(company, `PO-${suffix}-OUT`, day(3), project).lastInsertRowid), item, 61_000);
  } finally {
    db.close();
  }
  const api = (roles, user, method, path, data) => request.fetch(`/api/v1${path}`, { method, headers: headers(roles, company, user), data });
  // FR-04: the procurement manager prepares and back-tests the model; the project controls manager approves it in the inbox
  const model = (await (await api('PROCMGR', users.proc, 'POST', '/ai/models', { code: 'RATE_REG', name: 'Cement rate regression', useCase: 'RATE', method: 'REGRESSION', params: { lookback: 12 }, horizon: 6 })).json()).data;
  const bt = await api('PROCMGR', users.proc, 'POST', `/ai/models/${model.id}/backtest`, { itemId: item, region: 'TS' });
  expect(bt.status(), await bt.text()).toBe(200);
  expect((await api('PROCMGR', users.proc, 'POST', `/ai/models/${model.id}/submit`)).status()).toBe(200);
  const task = (await (await api('PCMGR', users.pcm, 'GET', '/workflow/tasks?mine=assigned')).json()).data.rows.find((x) => x.instance?.docId === String(model.id));
  expect((await api('PCMGR', users.pcm, 'POST', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'Back-test is good' })).status()).toBe(200);
  expect((await api('PCMGR', users.pcm, 'POST', '/ai/anomalies/run')).status()).toBe(200);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: users.proc, roles: 'PROCMGR', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // AC-01: the official forecast, labelled, with its range, drivers and the kind of each point
  await page.goto(`/ai/forecasts?itemId=${item}&region=TS`);
  await expect(page.getByRole('heading', { name: 'Forecasts & Anomalies', level: 1 })).toBeVisible();
  await expect(page.getByTestId('af-label')).toContainText('Forecast — statistical, verify');
  await expect(page.getByTestId('af-label')).toContainText('Official · model RATE_REG v1');
  await expect(page.getByTestId('af-next')).toContainText('Range');
  await expect(page.getByTestId('af-mape')).toContainText('%');
  await expect(page.getByTestId('af-drivers')).toContainText('price index');
  await expect(page.getByTestId('af-points').locator('tr[data-kind="FORECAST"]')).toHaveCount(6);
  await expect(page.getByTestId('af-points').locator('tr[data-kind="CALCULATED"]').first()).toContainText('Calculated');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/28.03/${phone ? 'mobile' : 'desktop'}-forecasts-anomalies.png`, fullPage: true });
  await checkAppearance(page);

  // T-01: the purchase rate flagged by the detection; the procurement manager confirms it with a note
  await page.getByTestId('af-tabs').getByRole('tab', { name: 'Anomalies' }).click();
  const flag = page.getByTestId('af-anomaly').filter({ hasText: 'PO-' });
  await expect(flag).toHaveCount(1);
  await expect(flag).toContainText('against a median');
  await flag.getByTestId('af-confirm').click();
  await flag.getByLabel('Note *').fill('Billed above the rate contract; raising a debit note');
  await flag.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('af-anomaly')).toHaveCount(0);
  await page.getByLabel('Status').selectOption('CONFIRMED');
  await expect(page.getByTestId('af-anomaly').first()).toContainText('raising a debit note');
  await noOverflow();

  // FR-04: the back-testing report of the approved model
  await page.getByTestId('af-tabs').getByRole('tab', { name: 'Models & back-testing' }).click();
  await page.getByTestId('af-models').getByRole('link', { name: 'RATE_REG v1' }).click();
  await expect(page.getByTestId('af-model')).toContainText('Official');
  await expect(page.getByTestId('af-bt-mape')).toContainText('%');
  await expect(page.getByTestId('af-backtest-rows').locator('tbody tr').first()).toBeVisible();
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/28.03/${phone ? 'mobile' : 'desktop'}-model-backtesting.png`, fullPage: true });
  expect(errors).toEqual([]);
});
