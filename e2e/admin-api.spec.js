import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Part 29.03 (AC-01, T-01, T-UI-01, T-UI-02): API clients and webhooks on a 1280 px desktop and a 360 px phone. IT creates a sandbox client
// (its secret shown once) and a write client that waits for the director, who approves it in the page; IT subscribes a webhook and sends a
// test, which the receiver verifies; the developer portal's try-it calls the real public API with the sandbox client; usage shows the calls.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main button')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('API clients and webhooks: a sandbox client, an approved write client, a verified webhook test and the portal try-it', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { it: `ap-it-${suffix}`, dir: `ap-dir-${suffix}` };
  const got = [];
  const rx = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { got.push({ sig: req.headers['x-signature'], type: req.headers['x-erp-event'], raw }); res.end('ok'); }); });
  await new Promise((r) => rx.listen(0, '127.0.0.1', r));
  try {
    const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
    const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `APX-${suffix.toUpperCase()}`, legalName: 'API Demo Infrastructure', shortName: 'API Demo' } });
    expect(created.status(), await created.text()).toBe(201);
    const { id: company } = (await created.json()).data;
    const db = new DatabaseSync('data/e2e.sqlite');
    db.exec('PRAGMA busy_timeout = 8000;');
    try {
      for (const [k, r] of [['it', 'ITADM'], ['dir', 'DIR']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
      for (const f of ['ff.admin.p2903', 'ff.plant.p1707']) db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'API browser fixture', 0, 1)").run(f, company);
    } finally {
      db.close();
    }
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
    await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.it, roles: 'ITADM', company: String(company) });
    const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const asUser = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };

    // FR-02 a read-only sandbox client: active at once, its secret shown once
    await page.goto('/admin/api');
    await expect(page.getByRole('heading', { name: 'API Clients & Webhooks', level: 1 })).toBeVisible();
    await page.getByTestId('dev-new').getByLabel('Name', { exact: true }).fill('Partner dashboard');
    await page.getByTestId('dev-new').getByLabel('Acts as role').selectOption('PM');
    await page.getByRole('checkbox', { name: /plant:read/ }).check();
    await page.getByTestId('dev-new').getByLabel('Reason', { exact: true }).fill('Read machine positions for the partner dashboard');
    await page.getByTestId('dev-create').click();
    const secret = (await page.getByTestId('dev-secret').locator('code').textContent()).trim();
    expect(secret).toMatch(/^cs_/);
    await page.getByRole('button', { name: 'I have saved it' }).click();
    const card = page.getByTestId('dev-client').filter({ hasText: 'Partner dashboard' });
    await expect(card).toContainText('Active');
    const clientId = (await card.locator('code').first().textContent()).trim();
    // section 9: a write client waits for the director
    await page.getByTestId('dev-new').getByLabel('Name', { exact: true }).fill('Fleet tracker feed');
    await page.getByTestId('dev-new').getByLabel('Acts as role').selectOption('PLANTMGR');
    await page.getByRole('checkbox', { name: /plant:write/ }).check();
    await page.getByTestId('dev-new').getByLabel('Reason', { exact: true }).fill('Telematics provider sends readings');
    await expect(page.getByTestId('dev-needs-dir')).toBeVisible();
    await page.getByTestId('dev-create').click();
    await page.getByRole('button', { name: 'I have saved it' }).click();
    await expect(page.getByTestId('dev-client').filter({ hasText: 'Fleet tracker feed' })).toContainText('Waiting for approval');
    await noOverflow();
    await page.screenshot({ path: `docs/erp/screenshots/29.03/${phone ? 'mobile' : 'desktop'}-api-clients-keys.png`, fullPage: true });
    await checkAppearance(page);
    await asUser(users.dir, 'DIR');
    await page.goto('/admin/api');
    await page.getByTestId('dev-client').filter({ hasText: 'Fleet tracker feed' }).getByTestId('dev-approve').click();
    await expect(page.getByTestId('dev-client').filter({ hasText: 'Fleet tracker feed' })).toContainText('Active');

    // FR-03 T-01 a webhook and its test delivery, signed
    await asUser(users.it, 'ITADM');
    await page.goto('/admin/api?tab=webhooks');
    await page.getByRole('combobox', { name: 'Client', exact: true }).selectOption({ label: 'Partner dashboard' });
    await page.getByLabel('Endpoint URL').fill(`http://127.0.0.1:${rx.address().port}/hooks/erp`);
    await page.getByLabel('Events', { exact: true }).fill('plant.*');
    await page.getByTestId('dev-h-create').click();
    await expect(page.getByTestId('dev-secret')).toContainText('whsec_');
    await page.getByRole('button', { name: 'I have saved it' }).click();
    await page.getByTestId('dev-ping').click();
    await expect(page.getByTestId('dev-delivery').first()).toContainText('Delivered');
    expect(got[0].type).toBe('admin.webhook.pinged');
    expect(got[0].sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    await noOverflow();

    // FR-04 the portal: endpoints with code, and try-it against the real public API with the sandbox client
    await page.getByRole('tab', { name: 'Developer portal' }).click();
    await expect(page.getByTestId('dev-endpoint').first()).toBeVisible();
    await page.getByTestId('dev-endpoint').filter({ hasText: '/api/public/v1/telematics/positions' }).getByRole('button', { name: 'Show code' }).click();
    await expect(page.getByTestId('dev-snippet')).toContainText('oauth/token');
    await page.getByLabel('Client id').fill(clientId);
    await page.getByLabel('Client secret').fill(secret);
    await page.getByRole('combobox', { name: 'Endpoint', exact: true }).selectOption({ label: 'GET /api/public/v1/telematics/positions' });
    await page.getByTestId('dev-t-send').click();
    await expect(page.getByTestId('dev-t-result')).toContainText('HTTP 200');
    // FR-05 usage
    await page.getByRole('tab', { name: 'Usage' }).click();
    await expect(page.getByTestId('dev-k-calls')).toContainText('1');
    await noOverflow();
    expect(errors).toEqual([]);
  } finally {
    rx.close();
  }
});
