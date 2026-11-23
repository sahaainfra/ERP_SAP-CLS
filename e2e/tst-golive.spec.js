import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { buildThreads } from '../tests/tst-fixtures.js';

// Parts 30.01-30.03 (AC-01, AC-02, AC-07, T-UI-01, T-UI-02): the go-live consoles on a 1280 px desktop and a 360 px phone, on a company with
// every business thread built. The QA lead runs the integration check (all threads green) and a latency probe (within 2 s) and reads the matrix;
// the CFO runs the reconciliation and reads its differences and the trace completeness; the QA lead runs the static scan and records a manual
// audit of a page. Each page: no sideways scroll at 360 px, tables as cards, labels not clipped at 125 % text in the dark and high-contrast themes.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main .kpi-label, main .kpi-value, main .tabs button, main .ph-actions button')]
        .filter((element) => element.getClientRects().length && getComputedStyle(element).overflow !== 'visible' && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('Go-live consoles: integration matrix green with a latency probe, reconciliation health, page completion audit', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { qa: `tst-qa-${suffix}`, cfo: `tst-cfo-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `TST-${suffix.toUpperCase()}`, legalName: 'Go-Live Demo Builders', shortName: 'Go-Live Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company, 'setup'), data: { legalName: 'Go-Live Demo Builders Pvt Ltd', reason: 'initial set-up' } })).status()).toBe(200);
  expect((await request.post('/api/v1/core/financial-years', { headers: headers('SYSADM', company, 'setup'), data: { startDate: '2026-04-01' } })).status()).toBeLessThan(300);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['qa', 'ITADM'], ['cfo', 'CFO']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    for (const f of ['ff.qa.p3001', 'ff.qa.p3002', 'ff.qa.p3003']) db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Go-live consoles browser fixture', 0, 1)").run(f, company);
    buildThreads(db, company);
  } finally {
    db.close();
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 404/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.qa, roles: 'ITADM', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const asUser = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };
  const cardsOnPhone = async (testid) => { if (phone) expect(await page.getByTestId(testid).evaluate((t) => getComputedStyle(t).display)).toBe('block'); };

  // 30.01: the integration check runs as a background job; every thread passes; the probe reaches the screen within the target
  await page.goto('/admin/integration-matrix');
  await expect(page.getByTestId('tst-integration')).toBeVisible();
  await expect(page.getByTestId('im-chart')).toBeVisible();
  await page.getByTestId('im-run').click();
  await expect(page.getByTestId('tst-integration')).toHaveAttribute('data-result', 'GREEN', { timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Integration Matrix');
  await expect(page.locator('main')).toContainText('Run ITR-');
  await expect(page.getByTestId('im-threads')).toContainText('15 / 15');
  await expect(page.getByTestId('im-thread')).toHaveCount(15);
  await page.getByTestId('im-probe').click();
  await expect(page.getByTestId('im-probe-result')).toHaveAttribute('data-status', 'PASS', { timeout: 30_000 });
  await page.locator('[data-testid="im-thread-toggle"][data-code="IT-02"]').click();
  await expect(page.locator('[data-testid="im-handoff"][data-code="IT-02.10"]')).toHaveAttribute('data-status', 'PASS');
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/30.01/${phone ? 'mobile' : 'desktop'}-integration-matrix-test-results.png`, fullPage: false });
  await checkAppearance(page);
  await page.getByTestId('im-tabs').getByRole('tab', { name: 'Matrix' }).click();
  await expect(page.getByTestId('im-matrix')).toBeVisible();
  await cardsOnPhone('im-matrix');
  if (phone) { await page.getByTestId('im-params-open').click(); await expect(page.getByTestId('im-params')).toBeVisible(); await page.getByTestId('im-params-close').click(); }
  await page.goto('/admin/integration-matrix?tab=matrix&q=bill.sub.approved');
  await expect(page.locator('[data-testid="im-edge"][data-event="bill.sub.approved"]')).toHaveCount(3);
  await page.getByTestId('im-tabs').getByRole('tab', { name: 'Re-keying' }).click();
  await expect(page.locator('main')).toContainText('No field is typed twice');
  await page.getByTestId('im-tabs').getByRole('tab', { name: 'Latency' }).click();
  await expect(page.getByTestId('im-probe-row')).toHaveCount(1);
  await noOverflow();

  // 30.02: the CFO runs the reconciliation; trace completeness 100 %; the receivable the fixture never posted is a Critical difference
  await asUser(users.cfo, 'CFO');
  await page.goto('/admin/reconciliation-health');
  await expect(page.getByTestId('tst-recon')).toBeVisible();
  await page.getByTestId('rh-run').first().click();
  await expect(page.getByTestId('rh-tiles')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('rh-trace')).toContainText('100');
  await expect(page.locator('[data-testid="rh-check-facts"][data-code="QTY_CHAIN"]')).toHaveAttribute('data-status', 'PASS');
  await expect(page.locator('[data-testid="rh-check-facts"][data-code="SUBLEDGER_GL"]')).toHaveAttribute('data-status', 'FAIL');
  await expect(page.getByTestId('rh-exception').first()).toHaveAttribute('data-severity', 'CRITICAL');
  await cardsOnPhone('rh-exception-table');
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/30.02/${phone ? 'mobile' : 'desktop'}-reconciliation-health.png`, fullPage: false });
  await checkAppearance(page);
  await page.getByTestId('rh-check').filter({ hasText: 'Sub-ledgers' }).getByRole('link', { name: /View all/ }).click();
  await expect(page.getByTestId('rh-exception').first()).toHaveAttribute('data-check', 'SUBLEDGER_GL');

  // 30.03: the QA lead runs the static scan (clean) and records a manual audit of a page by role
  await asUser(users.qa, 'ITADM');
  await page.goto('/admin/page-audit?module=tst');
  await expect(page.getByTestId('tst-page-audit')).toBeVisible();
  await page.getByTestId('pa-scan').click();
  await expect(page.getByTestId('pa-scan-result')).toContainText(', 0 with findings');
  await expect(page.getByTestId('pa-row')).toHaveCount(3);
  await cardsOnPhone('pa-table');
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/30.03/${phone ? 'mobile' : 'desktop'}-page-completion-audit.png`, fullPage: false });
  await checkAppearance(page);
  await page.locator('[data-testid="pa-row"][data-code="admin.page-audit"]').getByRole('link').click();
  await expect(page.getByTestId('pa-panel')).toBeVisible();
  await page.getByTestId('pa-record').click();
  await page.getByTestId('pa-form-role').selectOption('ITADM');
  await expect(page.getByTestId('pa-point')).toHaveCount(13);
  await page.getByTestId('pa-form-notes').fill(`Checked on a ${phone ? '360 px phone' : '1280 px desktop'}.`);
  await page.getByTestId('pa-form-save').click();
  await expect(page.locator('[data-testid="pa-audit"][data-kind="MANUAL"]')).toHaveAttribute('data-status', 'PASS');
  await noOverflow();
  expect(errors).toEqual([]);
});
