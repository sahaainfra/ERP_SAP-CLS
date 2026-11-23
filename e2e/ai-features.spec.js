import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 28.01 (AC-01, T-UI-01, T-UI-02): AI Features & Enablement on a 1280 px desktop and a 360 px phone — the system administrator prepares a
// version of the variance narrative, runs its evaluation and sends it; the director approves it in the inbox; a project manager's call is
// answered and labelled; the director stops all AI with the kill switch and the next call is refused; usage and the AI log show it.

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

test('AI features: evaluate, approve SYSADM → DIR, a governed call, the kill switch, usage and log', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { sys: `ai-sys-${suffix}`, dir: `ai-dir-${suffix}`, pm: `ai-pm-${suffix}`, aud: `ai-aud-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `AIG-${suffix.toUpperCase()}`, legalName: 'AI Demo Infrastructure', shortName: 'AI Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company, 'setup'), data: { legalName: 'AI Demo Infrastructure', reason: 'Set up the AI fixture' } })).ok()).toBe(true);
  let project;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['sys', 'SYSADM'], ['dir', 'DIR'], ['pm', 'PM'], ['aud', 'AUD']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'AI browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.bi.p2708', 'ff.ai.p2801']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'MTR-09', 'Metro station package 9', 'BUILDING', 'ACTIVE')").run(company).lastInsertRowid);
    db.prepare("INSERT INTO ctl_facts (company_id, org_project_id, resource_type, budget_qty, budget_cost, earned_cost, actual_qty, actual_cost) VALUES (?, ?, 'MATERIAL', 100000, 10000000, 5000000, 60000, 7000000)").run(company, project);
    db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status) VALUES (?, ?, 'Sandbox model', 'ai', 'sandbox', 'development', ?, 'ENABLED')").run(company, `ai.sandbox-${suffix}`, JSON.stringify({ model: 'sandbox-1' }));
  } finally {
    db.close();
  }
  const api = (roles, user, method, path, data) => request.fetch(`/api/v1${path}`, { method, headers: headers(roles, company, user), data });
  expect((await api('SYSADM', users.sys, 'POST', '/ai/providers', { code: 'sandbox', provider: 'sandbox', model: 'sandbox-1', connector: `ai.sandbox-${suffix}`, priceInPerMTok: 300, priceOutPerMTok: 1500 })).status()).toBe(201);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 4(23|03|29)/.test(message.text())) errors.push(message.text()); });
  const as = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.sys, roles: 'SYSADM', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // the system administrator prepares a version: roles, evaluation, send
  await page.goto('/ai/features');
  await expect(page.getByRole('heading', { name: 'AI Features & Enablement', level: 1 })).toBeVisible();
  await expect(page.getByTestId('ai-kill')).toContainText('AI is on');
  await page.getByTestId('ai-feature-card').filter({ hasText: 'Variance narrative' }).getByTestId('ai-new-version').click();
  await expect(page.getByTestId('ai-feature')).toContainText('Draft');
  await page.getByTestId('ai-edit').click();
  await page.getByLabel('Roles *').fill('PM, DIR');
  await page.getByTestId('ai-feature-form').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('ai-feature-settings')).toContainText('PM, DIR');
  await page.getByTestId('ai-evaluate').click();
  await expect(page.getByTestId('ai-eval').getByText('Pass')).toHaveCount(3);
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/28.01/${phone ? 'mobile' : 'desktop'}-ai-features-enablement.png`, fullPage: true });
  await checkAppearance(page);
  await page.getByTestId('ai-submit').click();
  await expect(page.getByTestId('ai-feature')).toContainText('Waiting for the director');
  // the director approves from the inbox (API of the workflow engine, as the inbox does)
  const tasks = await (await api('DIR', users.dir, 'GET', '/workflow/tasks?mine=assigned')).json();
  const task = tasks.data.rows.find((x) => x.instance?.docType === 'AI_FEATURE') ?? tasks.data.rows[0];
  expect((await api('DIR', users.dir, 'POST', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'Evaluation passed' })).status()).toBe(200);
  // a project manager's call is answered, labelled, logged
  const ok = await api('PM', users.pm, 'POST', '/ai/run/ai.variance_narrative', { input: { projectId: project, kpi: 'cost' } });
  expect(ok.status(), await ok.text()).toBe(200);
  expect((await ok.json()).data.label).toBe('AI-generated — verify');
  // the director stops all AI
  await as(users.dir, 'DIR');
  await page.goto('/ai/features');
  await page.getByLabel('Reason').first().fill('Provider incident under review');
  await page.getByTestId('ai-kill-toggle').click();
  await expect(page.getByTestId('ai-kill')).toContainText('AI is switched off');
  expect((await api('PM', users.pm, 'POST', '/ai/run/ai.variance_narrative', { input: { projectId: project } })).status()).toBe(423);
  await page.getByTestId('ai-tabs').getByRole('tab', { name: 'Usage & cost' }).click();
  await expect(page.getByTestId('ai-usage-tiles')).toBeVisible();
  await noOverflow();
  // the auditor reads the log
  await as(users.aud, 'AUD');
  await page.goto('/ai/features?tab=log');
  await expect(page.getByTestId('ai-log-row').first()).toBeVisible();
  await expect(page.locator('[data-testid="ai-log-row"][data-outcome="BLOCKED"]').first()).toBeVisible();
  await page.locator('[data-testid="ai-log-row"][data-outcome="OK"]').first().getByRole('link').click();
  await expect(page.getByTestId('ai-log-prompt')).toContainText('<data>');
  await noOverflow();
  if (!phone) await page.screenshot({ path: 'docs/erp/screenshots/28.01/desktop-ai-log.png', fullPage: true });
  expect(errors).toEqual([]);
});
