import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 28.02 (FR-01, T-01, T-UI-01, T-UI-02): the assistant panel from the shell on a 1280 px desktop and a 360 px phone — a director asks a
// question (the governed query and the cited records are shown, with the AI label), gives a thumbs-up, drafts an RFI and saves it as a DRAFT of
// the engineering module as a site engineer; no horizontal scroll, no clipped labels at larger text, no console errors.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main button, main .kpi-label, main .kpi-value, .aa-dock button')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('Assistant panel: governed answer with its query and records, feedback, and an RFI saved as a DRAFT', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { sys: `aa-sys-${suffix}`, dir: `aa-dir-${suffix}`, se: `aa-se-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `AAS-${suffix.toUpperCase()}`, legalName: 'Assistant Demo Infrastructure', shortName: 'Assistant Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company, 'setup'), data: { legalName: 'Assistant Demo Infrastructure', reason: 'Set up the assistant fixture' } })).ok()).toBe(true);
  let project;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['sys', 'SYSADM'], ['dir', 'DIR'], ['se', 'SE']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Assistant browser fixture', 0, 1)");
    for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.ai.p2801', 'ff.ai.p2802']) flag.run(code, company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'FLY-02', 'Flyover package 2', 'BRIDGE', 'ACTIVE')").run(company).lastInsertRowid);
    db.prepare("INSERT INTO proj_projects (company_id, project_id, status, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (?, ?, 'APPROVED', 'EXECUTION', 'pm', 100000000, '2026-01-01', '2027-12-31', 'e2e')").run(company, project);
    db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status) VALUES (?, ?, 'Sandbox model', 'ai', 'sandbox', 'development', ?, 'ENABLED')").run(company, `ai.box-${suffix}`, JSON.stringify({ model: 'sandbox-1' }));
  } finally {
    db.close();
  }
  const api = (roles, user, method, path, data) => request.fetch(`/api/v1${path}`, { method, headers: headers(roles, company, user), data });
  expect((await api('SYSADM', users.sys, 'POST', '/ai/providers', { code: 'box', provider: 'sandbox', model: 'sandbox-1', connector: `ai.box-${suffix}`, priceInPerMTok: 300, priceOutPerMTok: 1500 })).status()).toBe(201);
  for (const code of ['ai.assistant', 'ai.draft_document']) {
    const f = await (await api('SYSADM', users.sys, 'POST', '/ai/features', { code, providerCode: 'box', roles: ['SE', 'DIR'], quota: { perUserDaily: 50, monthlyBudget: 1000, alertPct: 80 } })).json();
    const ev = await (await api('SYSADM', users.sys, 'POST', `/ai/features/${f.data.id}/evaluate`)).json();
    expect(ev.data.evaluation.passed, JSON.stringify(ev.data.evaluation)).toBe(true);
    expect((await api('SYSADM', users.sys, 'POST', `/ai/features/${f.data.id}/submit`)).status()).toBe(200);
    const tasks = (await (await api('DIR', users.dir, 'GET', '/workflow/tasks?mine=assigned')).json()).data.rows;
    const task = tasks.find((x) => x.instance?.docId === String(f.data.id)) ?? tasks[0];
    expect((await api('DIR', users.dir, 'POST', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'ok' })).status()).toBe(200);
  }

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.dir, roles: 'DIR', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // FR-01: the dock is in the shell on an ordinary page and knows the project of the page
  await page.goto(`/home?projectId=${project}`);
  await page.getByTestId('aa-fab').click();
  const panel = page.getByTestId('aa-panel');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Your question').fill('What is the status of the projects?');
  await panel.getByTestId('aa-ask').click();
  const answer = panel.getByTestId('aa-answer').first();
  await expect(answer).toContainText('AI-generated — verify');
  await expect(answer.getByTestId('aa-query')).toContainText('dataset(project-status)');
  await expect(answer.getByTestId('aa-sources')).toContainText('FLY-02');
  await answer.getByTestId('aa-up').click();
  await expect(answer.getByTestId('aa-up')).toHaveAttribute('aria-pressed', 'true');
  // the dock sits in the shell's top bar in the DOM: its text must not take the bar's white colour
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.aa-text')).color)).not.toBe('rgb(255, 255, 255)');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/28.02/${phone ? 'mobile' : 'desktop'}-assistant-panel.png`, fullPage: false });
  await checkAppearance(page);
  // FR-03, T-01: a site engineer (who may raise RFIs) drafts one, reviews it and saves it as a DRAFT of the engineering module
  await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: users.se, roles: 'SE', company: String(company) });
  await page.goto(`/home?projectId=${project}`);
  await page.getByTestId('aa-fab').click();
  await panel.getByRole('tab', { name: 'Draft' }).click();
  await panel.getByLabel('What to draft').selectOption('RFI');
  await panel.getByLabel('Brief').fill('Ask the structural consultant to confirm the pier cap reinforcement detail at P12.');
  await panel.getByTestId('aa-draft').click();
  await expect(panel.getByTestId('aa-draft-result')).toContainText('AI-generated — verify');
  await panel.getByLabel('Subject *').fill('Pier cap reinforcement at P12');
  await panel.getByLabel('Answer needed by *').fill('2027-01-20');
  await panel.getByTestId('aa-save-draft').click();
  await expect(panel.getByTestId('aa-saved')).toContainText('Saved as draft');
  const check = new DatabaseSync('data/e2e.sqlite');
  try { expect(check.prepare('SELECT status FROM engg_rfis WHERE company_id = ? ORDER BY id DESC LIMIT 1').get(company).status).toBe('DRAFT'); } finally { check.close(); }
  await noOverflow();
  expect(errors).toEqual([]);
});
