import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 27.09 (AC-01, T-UI-01, T-UI-02): the Leakage & Controls Tower on a 1280 px desktop and a 360 px phone — the detection rules run as a
// job on real records, the tower shows the value at risk by type and project and the controls by mode, a finding is taken into review and
// closed with its outcome, and the rules show their thresholds; no horizontal scroll, no clipped labels at larger text, no console errors.

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
const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const agoIso = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

test('Leakage & Controls Tower: rules run, tower, finding closed with an outcome, rules — desktop and phone', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const cfo = `lk-cfo-${suffix}`;
  const headers = (roles, company, user = cfo) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1), data: { code: `LK-${suffix.toUpperCase()}`, legalName: 'Leakage Demo Infrastructure', shortName: 'Leakage Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company), data: { legalName: 'Leakage Demo Infrastructure', reason: 'Set up the leakage fixture' } })).ok()).toBe(true);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [u, r] of [[cfo, 'CFO'], [`lk-pm-${suffix}`, 'PM'], [`lk-acc-${suffix}`, 'ACCMGR'], [`lk-proc-${suffix}`, 'PROCMGR']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, u, u, JSON.stringify([r]));
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Leakage browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2709']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'HWY-07', 'Highway package 7', 'ROAD', 'ACTIVE')").run(company).lastInsertRowid);
    const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, 'HWY-S1', 'Km 12 camp', 'ACTIVE')").run(company, project).lastInsertRowid);
    db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (?, ?, ?, 100000000, '2026-01-01', '2027-12-31', 'e2e')").run(company, project, `lk-pm-${suffix}`);
    // the records the rules read, with the masters they point to (the Data Health check of a whole run finds no orphan rows)
    const vendor = (code, name) => Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, code, name, name).lastInsertRowid);
    const aggregates = vendor(`LK-SA-${suffix}`, 'Shree Aggregates'); const bitumen = vendor(`LK-BT-${suffix}`, 'Deccan Bitumen');
    const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from) VALUES (?, ?, 'OPC cement 53 grade', 'MATERIAL', 2, 'bag', '2024-01-01')").run(company, `LK-CEM-${suffix}`).lastInsertRowid);
    const bill = db.prepare("INSERT INTO ap_bills (company_id, doc_no, bill_source, org_project_id, org_site_id, partner_id, payee_name, bill_no, bill_date, due_date, total_paise, status) VALUES (?, ?, 'DIRECT', ?, ?, ?, 'Shree Aggregates', 'SA-1042', ?, ?, 18450000, 'APPROVED')");
    bill.run(company, `APB-${suffix}1`, project, site, aggregates, ago(12), ago(-18)); bill.run(company, `APB-${suffix}2`, project, site, aggregates, ago(9), ago(-21));
    const po = db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, po_site_id, vendor_id, total_amount, status, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'APPROVED', 'buyer')");
    po.run(company, `PO-${suffix}1`, ago(8), project, site, bitumen, 24_000_000); po.run(company, `PO-${suffix}2`, ago(6), project, site, bitumen, 23_500_000); po.run(company, `PO-${suffix}3`, ago(4), project, site, bitumen, 22_000_000);
    const big = Number(po.run(company, `PO-${suffix}4`, ago(2), project, site, bitumen, 90_000_000).lastInsertRowid);
    db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, description, qty, uom, rate, benchmark_rate) VALUES (?, ?, 1, 'Bitumen VG-30', 40000, 't', 5200000, 4600000)").run(company, big);
    const store = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, store_status, requested_by) VALUES (?, ?, 'Km 12 store', 'SITE_STORE', ?, ?, 'ACTIVE', 'x')").run(company, `HWY-ST-${suffix}`, project, site).lastInsertRowid);
    const bin = Number(db.prepare("INSERT INTO inv_bins (company_id, store_id, code, is_default, created_by) VALUES (?, ?, 'MAIN', 1, 'e2e')").run(company, store).lastInsertRowid);
    db.prepare("INSERT INTO inv_stock_ledger (company_id, doc_no, store_id, bin_id, item_id, txn_type, txn_date, qty_in, balance_qty, balance_value, posted_by) VALUES (?, ?, ?, ?, ?, 'RECEIPT', ?, 80000, 80000, 6400000, 'x')").run(company, `SL-${suffix}`, store, bin, item, ago(240));
    const cp = Number(db.prepare("INSERT INTO pcs_control_points (company_id, code, module, stage, description, rule_ref, enforcement, owner_role, mode) VALUES (?, 'CP-PROC-01', 'proc', 'APPROVE', 'Order above budget', 'x', 'EXCEPTION', 'PROCMGR', 'ENFORCE')").run(company).lastInsertRowid);
    db.prepare("INSERT INTO pcs_control_points (company_id, code, module, stage, description, rule_ref, enforcement, owner_role, mode) VALUES (?, 'CP-INV-02', 'inv', 'RECORD', 'Issue above norm', 'x', 'WARN', 'STOREMGR', 'OBSERVE')").run(company);
    db.prepare("INSERT INTO pcs_exceptions (company_id, exception_no, control_id, control_code, entity, entity_id, reason_code, justification, value_at_risk, status, emergency, regularise_by, raised_by, project_id, created_at) VALUES (?, ?, ?, 'CP-PROC-01', 'po', '1', 'URGENT', 'Breakdown spares', 4500000, 'APPROVED', 1, ?, ?, ?, ?)")
      .run(company, `EXC-${suffix}1`, cp, agoIso(3), `lk-proc-${suffix}`, project, agoIso(12));
  } finally {
    db.close();
  }
  const run = await request.post('/api/v1/bi/detection/runs', { headers: headers('CFO', company), data: {} });
  expect(run.status(), await run.text()).toBe(202);
  await expect.poll(async () => (await (await request.get('/api/v1/bi/leakage', { headers: headers('CFO', company) })).json()).data?.tiles?.open ?? 0, { timeout: 20_000 }).toBeGreaterThanOrEqual(5);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: cfo, roles: 'CFO', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // the tower
  await page.goto('/bi/leakage');
  await expect(page.getByRole('heading', { name: 'Leakage & Controls Tower', level: 1 })).toBeVisible();
  await expect(page.getByTestId('lk-risk')).toBeVisible();
  await expect(page.getByTestId('lk-card-rules')).toBeVisible();
  await expect(page.getByTestId('lk-modes')).toContainText('Enforce: 1');
  await expect(page.getByTestId('lk-modes')).toContainText('Observe: 1');
  await expect(page.getByTestId('lk-card-top').getByRole('link').first()).toBeVisible();
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/27.09/${phone ? 'mobile' : 'desktop'}-leakage-controls-tower.png`, fullPage: true });
  await checkAppearance(page);

  // the worklist and one finding taken into review and closed as prevented
  await page.getByTestId('lk-tabs').getByRole('tab', { name: 'Findings' }).click();
  await expect(page.getByTestId('lk-finding-row').first()).toBeVisible();
  await page.getByTestId('lk-finding-row').filter({ hasText: 'Duplicate vendor invoice' }).getByRole('link').first().click();
  await expect(page.getByTestId('lk-finding')).toContainText('Duplicate vendor invoice');
  await page.getByTestId('lk-review').click();
  await expect(page.getByTestId('lk-finding')).toContainText('In review');
  await page.getByLabel('Outcome').selectOption('PREVENTED');
  await page.getByLabel('Resolution').fill('Second bill held before payment; vendor confirmed it was a resend.');
  await page.getByTestId('lk-close-submit').click();
  await expect(page.getByTestId('lk-finding')).toContainText('Closed');
  await expect(page.getByTestId('lk-finding')).toContainText('Prevented');
  await noOverflow();
  if (!phone) await page.screenshot({ path: 'docs/erp/screenshots/27.09/desktop-finding.png', fullPage: true });

  // the rules
  await page.goto('/bi/leakage?tab=rules');
  await expect(page.locator('[data-testid="lk-rules"] tbody tr')).toHaveCount(13);
  await noOverflow();
  if (!phone) await page.screenshot({ path: 'docs/erp/screenshots/27.09/desktop-detection-rules.png', fullPage: true });
  expect(errors).toEqual([]);
});
