import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { todayIST } from '../src/shared/dates.js';

async function checkAppearance(page) {
  const originalTheme = await page.locator('html').getAttribute('data-theme') ?? 'light';
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main button')]
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

test('BI reports, subscriptions and metric catalogue work on desktop and phone', async ({ page, request }, info) => {
  const companyCode = info.project.name === 'mobile' ? 'BIR-M' : 'BIR-D';
  const reviewer = `bi-reviewer-${info.project.name}`;
  const headers = (roles, company) => ({
    'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': reviewer,
    'idempotency-key': randomUUID(),
  });
  const companyResponse = await request.post('/api/v1/iam/org/companies', {
    headers: headers('SYSADM', 1),
    data: { code: companyCode, legalName: 'Reporting Demo Infrastructure', shortName: 'Reporting Demo' },
  });
  expect(companyResponse.status(), await companyResponse.text()).toBe(201);
  const { id: company } = (await companyResponse.json()).data;
  const setup = await request.put('/api/v1/core/company-settings', {
    headers: headers('SYSADM', company), data: { legalName: 'Reporting Demo Infrastructure', reason: 'Set up report review fixture' },
  });
  expect(setup.ok(), await setup.text()).toBe(true);
  const db = new DatabaseSync(process.env.BI_E2E_DATABASE ?? 'data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  let client;
  try {
    db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, 'BI Reviewer', '[\"PD\"]')").run(company, reviewer);
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'BI browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.site.p1405', 'ff.fin.p2311', 'ff.fin.p2305']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate');
    gate.run(company, 'G2', 'Workforce Gate');
    client = Number(db.prepare(`INSERT INTO mdm_partners
      (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type)
      VALUES (?, 'BI-CLIENT', 'City Development Authority', 'city development authority', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 'e2e', 'e2e')`).run(company).lastInsertRowid);
    db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, 'CLIENT')").run(company, client);
  } finally {
    db.close();
  }
  const project = await request.post('/api/v1/proj/projects', {
    headers: headers('PCMGR', company),
    data: {
      basics: { code: 'BRG-01', name: 'River bridge rehabilitation', type: 'ROAD', sector: 'ROADS', location: 'Pune' },
      contract: { clientPartnerId: client, contractType: 'ITEM_RATE', contractNo: 'CITY/BRG/01' },
      sites: [{ code: 'BRG-S1', name: 'River bridge site', siteType: 'SITE' }],
      team: {}, setup: {}, milestones: [],
    },
  });
  expect(project.status(), await project.text()).toBe(201);
  const { projectId } = (await project.json()).data;
  const facts = new DatabaseSync(process.env.BI_E2E_DATABASE ?? 'data/e2e.sqlite');
  let sourceId;
  try {
    facts.exec('PRAGMA busy_timeout = 8000;');
    sourceId = Number(facts.prepare(`INSERT INTO prs_periods
      (company_id, doc_no, org_project_id, period_type, period_start, period_end, status)
      VALUES (?, 'BI-PROGRESS', ?, 'MONTH', '2025-02-01', '2025-02-28', 'APPROVED')`).run(company, projectId).lastInsertRowid);
    facts.prepare(`INSERT INTO prs_evm (company_id, org_project_id, period_id, period_end, spi, cpi)
      VALUES (?, ?, ?, '2025-02-28', 8750, 9500)`).run(company, projectId, sourceId);
    const date = todayIST();
    facts.prepare(`INSERT INTO ar_invoices (company_id,doc_no,inv_source,org_project_id,partner_id,invoice_date,due_date,amount_paise,received_paise,status)
      VALUES (?,'BI-AR','OTHER_INCOME',?,?,?,?,100000,40000,'APPROVED')`).run(company, projectId, client, date, date);
  } finally {
    facts.close();
  }

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text());
  });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), {
    user: reviewer, roles: 'PD', company: String(company),
  });
  await page.goto('/bi/reports');
  await expect(page.getByRole('heading', { name: 'Report Catalogue', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'River bridge rehabilitation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Progress by WBS and Activity', exact: true }).last()).toHaveAttribute('href', '/site/progress-report');
  await page.getByLabel('Find a report').fill('Project Status');
  await page.getByLabel('Lifecycle state').selectOption('EXECUTION');
  await expect(page.getByText('No matching projects')).toBeVisible();
  await page.getByLabel('Lifecycle state').selectOption('SETUP');
  await expect(page.getByRole('heading', { name: 'River bridge rehabilitation' })).toBeVisible();
  const [standardFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  expect(standardFile.suggestedFilename()).toMatch(/^bi-project_status-.+\.csv$/);
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.01/${info.project.name}-report-catalogue.png`, fullPage: true });
  await checkAppearance(page);

  await page.goto('/bi/builder');
  await expect(page.getByRole('heading', { name: 'Report Builder', exact: true })).toBeVisible();
  await page.getByLabel('Report name').fill('Projects in setup');
  await page.getByLabel('Lifecycle state').selectOption('SETUP');
  await page.getByLabel('Group project count by').selectOption('state');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'River bridge rehabilitation' })).toBeVisible();
  await expect(page.getByText('Setup · 1 of 1')).toBeVisible();
  const [customFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export rows' }).click()]);
  expect(customFile.suggestedFilename()).toMatch(/^bi-project_status_builder-.+\.csv$/);
  await page.getByRole('button', { name: 'Save report' }).click();
  await expect(page.getByText('Report saved.')).toBeVisible();
  await page.getByRole('button', { name: 'New report' }).click();
  await page.getByRole('button', { name: 'Projects in setup' }).click();
  await expect(page.getByRole('heading', { name: 'River bridge rehabilitation' })).toBeVisible();
  await expect(page.getByLabel('Report name')).toHaveValue('Projects in setup');
  await expect(page.getByLabel('Group project count by')).toHaveValue('state');
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.02/${info.project.name}-report-builder.png`, fullPage: true });
  await checkAppearance(page);
  await page.goto('/bi/subscriptions');
  await expect(page.getByRole('heading', { name: 'Report Subscriptions', exact: true })).toBeVisible();
  await page.getByLabel('Subscription name').fill('Weekly setup report');
  await page.getByRole('combobox', { name: 'Report', exact: true }).selectOption({ label: 'Projects in setup' });
  await page.getByRole('button', { name: 'Create subscription' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly setup report' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Frequency').selectOption('MONTHLY');
  await page.getByRole('button', { name: 'Save subscription' }).click();
  await expect(page.getByText('Monthly on the first day · CSV · In-app notification')).toBeVisible();
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.01/${info.project.name}-report-subscriptions.png`, fullPage: true });
  await checkAppearance(page);
  const auditPage = await page.context().newPage();
  auditPage.on('pageerror', (error) => errors.push(error.message));
  await auditPage.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), {
    user: `bi-auditor-${info.project.name}`, roles: 'AUD', company: String(company),
  });
  await auditPage.goto('/bi/usage');
  await expect(auditPage.getByRole('heading', { name: 'Report Usage', exact: true })).toBeVisible();
  await expect(auditPage.getByText('Project Status · CSV · 1', { exact: true })).toBeVisible();
  await auditPage.getByRole('combobox', { name: 'Period' }).selectOption('7');
  await expect(auditPage.getByText('Project Status Builder · CSV · 1', { exact: true })).toBeVisible();
  await expect.poll(() => auditPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await auditPage.screenshot({ path: `docs/erp/screenshots/27.01/${info.project.name}-report-usage.png`, fullPage: true });
  await checkAppearance(auditPage);
  await auditPage.close();
  const metricPath = '/api/v1/bi/metrics';
  const openMetricAs = async (roles, user) => {
    const rolePage = await page.context().newPage();
    rolePage.on('pageerror', (error) => errors.push(error.message));
    await rolePage.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), {
      user, roles, company: String(company),
    });
    await rolePage.goto('/bi/metrics');
    await expect(rolePage.getByRole('heading', { name: 'Metric Catalogue', exact: true })).toBeVisible();
    return rolePage;
  };
  const makerPage = await openMetricAs('PCMGR', reviewer);
  await makerPage.getByLabel('Reason', { exact: true }).fill('Verified with the project register');
  await makerPage.getByRole('button', { name: 'Request certification' }).click();
  await expect(makerPage.getByText('Awaiting review', { exact: false })).toBeVisible();
  await expect(makerPage.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  const makerDomain = makerPage.getByRole('region', { name: 'Project metrics', exact: true });
  await makerDomain.getByRole('combobox', { name: 'Metric', exact: true }).selectOption('spi');
  await makerDomain.getByLabel('Reason', { exact: true }).fill('Verified with the approved progress period');
  await makerDomain.getByRole('button', { name: 'Request certification' }).click();
  await expect(makerDomain.getByText('Awaiting review', { exact: false })).toBeVisible();
  await makerPage.close();

  const checkerPage = await openMetricAs('CFO', `metric-checker-${info.project.name}`);
  await checkerPage.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(checkerPage.getByText('Certified', { exact: true })).toBeVisible();
  const checkerDomain = checkerPage.getByRole('region', { name: 'Project metrics', exact: true });
  await checkerDomain.getByRole('combobox', { name: 'Metric', exact: true }).selectOption('spi');
  await checkerDomain.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(checkerDomain.getByText('Certified', { exact: true })).toBeVisible();
  await checkerDomain.getByRole('combobox', { name: 'Metric', exact: true }).selectOption('dso');
  await checkerDomain.getByRole('combobox', { name: 'Metric project', exact: true }).selectOption(String(projectId));
  await expect(checkerDomain.getByText('54 days', { exact: true })).toBeVisible();
  await checkerDomain.getByRole('link', { name: 'Open source report' }).click();
  await expect(checkerPage.getByTestId('ar-dso')).toHaveText('54 days');
  await checkerPage.close();

  const operatorPage = await openMetricAs('ITADM', `metric-operator-${info.project.name}`);
  await operatorPage.getByRole('button', { name: 'Queue monthly capture' }).click();
  await expect(operatorPage.getByText('Capture queued.', { exact: false })).toBeVisible();
  await operatorPage.close();
  await expect.poll(async () => {
    const res = await request.get(metricPath, { headers: headers('PD', company) });
    return (await res.json()).data?.freshness;
  }, { timeout: 25_000 }).toBe('CURRENT');
  await page.goto('/bi/metrics');
  await expect(page.getByRole('heading', { name: 'Metric Catalogue', exact: true })).toBeVisible();
  await expect(page.getByText('Certified', { exact: true })).toBeVisible();
  await page.getByText('Source lineage', { exact: true }).click();
  await expect(page.getByText('proj.projects', { exact: true })).toBeVisible();
  await expect(page.getByText('1 project · Capture complete', { exact: true })).toBeVisible();
  const [historyFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export history' }).click()]);
  expect(historyFile.suggestedFilename()).toMatch(/^bi-project_history-.+\.csv$/);
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/27.03/${info.project.name}-metric-catalogue-with-lineage-view.png`, fullPage: true });
  await checkAppearance(page);
  await page.getByRole('combobox', { name: 'Metric', exact: true }).selectOption('spi');
  await page.getByRole('combobox', { name: 'Metric project', exact: true }).selectOption(String(projectId));
  await expect(page.getByRole('heading', { name: 'Latest approved value' })).toBeVisible();
  await expect(page.getByText('0.8750 · Source revision 1')).toBeVisible();
  await expect(page.getByText('0.8750 · Source period 2025-02-28 · Revision 1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open source record' })).toHaveAttribute('href', `/site/periods?id=${sourceId}`);
  const [domainFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export metric history' }).click()]);
  expect(domainFile.suggestedFilename()).toMatch(/^bi-spi_history-.+\.csv$/);
  await page.getByText('Metric lineage', { exact: true }).click();
  await expect(page.getByText('Project Controls', { exact: true })).toBeVisible();
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/27.03/${info.project.name}-domain-metrics.png`, fullPage: true });
  await checkAppearance(page);
  expect(errors).toEqual([]);
});
