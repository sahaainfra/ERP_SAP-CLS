import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 29.08 (AC-01, T-01, T-UI-01, T-UI-02): help desk on a 1280 px desktop and a 360 px phone. A site engineer opens Help on the home page
// (its article and an announcement), raises a ticket from it in three steps (the page captured); after a failed call the next ticket carries
// its correlation ID, which the support team sees in the queue; support resolves it and the engineer rates it.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main .tabs button, main .hd-footer button')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('Help desk: help on a page, a ticket raised from it, a failed call carried to support, resolved and rated', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { se: `hd-se-${suffix}`, it: `hd-it-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `HDX-${suffix.toUpperCase()}`, legalName: 'Help Demo Infrastructure', shortName: 'Help Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['se', 'SE'], ['it', 'ITADM']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2908', ?, 'Help desk browser fixture', 0, 1)").run(company);
    const art = db.prepare("INSERT INTO hd_articles (company_id, kind, title, body, page_codes_json, roles_json, valid_from, valid_to, status) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, 'PUBLISHED')");
    art.run(company, 'ARTICLE', 'Getting around the home page', '## Home\nYour tasks and approvals are on the first card.', '["/home"]', null, null);
    art.run(company, 'ANNOUNCEMENT', 'ERP upgrade tonight', 'Save your work by 10 pm.', '[]', new Date(Date.now() - 3_600_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
  } finally {
    db.close();
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 404/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.se, roles: 'SE', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const asUser = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };

  // FR-03 FR-04 Help on a page: its article and the announcement
  await page.goto('/home');
  await expect(page.getByTestId('hd-announcement')).toContainText('ERP upgrade tonight');
  await page.getByTestId('hd-fab').click();
  await expect(page.getByTestId('hd-panel')).toContainText('Getting around the home page');
  // FR-01 T-01 a ticket raised from the page, in three steps
  await page.getByTestId('hd-raise').click();
  await expect(page.getByTestId('hd-context')).toContainText('From the page');
  await page.getByLabel('In one line').fill('Approvals card does not load');
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/29.08/${phone ? 'mobile' : 'desktop'}-raise-ticket.png`, fullPage: true });
  await checkAppearance(page);
  await page.getByTestId('hd-next').click();
  await page.getByLabel(/What did you do/).fill('The approvals card on the home page stays empty since this morning.');
  await page.getByTestId('hd-next').click();
  await page.getByLabel('WhatsApp').check();
  await page.getByTestId('hd-submit').click();
  await expect(page.getByTestId('hd-raised')).toContainText('HD-000001');

  // T-01 after a failed call, the next ticket carries its correlation ID
  await page.goto('/help?tab=kb&article=999999');
  await expect(page.getByTestId('hd-page')).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: 'Raise a ticket' }).click();
  await expect(page.getByTestId('hd-context')).toContainText('Attach the last error (status 404');
  await page.getByLabel('Kind of problem').selectOption('BUG');
  await page.getByLabel('In one line').fill('Article link gives an error');
  await page.getByTestId('hd-next').click();
  await page.getByLabel(/What did you do/).fill('The link to the safety article from the tour gives an error.');
  await page.getByTestId('hd-next').click();
  await page.getByTestId('hd-submit').click();
  await expect(page.getByTestId('hd-raised')).toContainText('HD-000002');

  // the support team sees the page and the correlation ID, takes and resolves it
  await asUser(users.it, 'ITADM');
  await page.goto('/admin/support');
  await page.getByTestId('hd-queuerow').filter({ hasText: 'HD-000002' }).locator('button').click();
  await expect(page.getByTestId('hd-correlation')).toHaveText(/^[0-9a-f-]{36}$/);
  await page.getByTestId('hd-assign').click();
  await expect(page.getByTestId('hd-ticket')).toContainText('Assigned');
  await page.getByLabel('Note to the person, or the resolution').fill('The article was retired; the tour now links to the new one.');
  await page.getByTestId('hd-resolve').click();
  await expect(page.getByTestId('hd-ticket')).toContainText('Resolved');
  await noOverflow();

  // FR-05 the engineer rates it
  await asUser(users.se, 'SE');
  await page.goto('/help?tab=mine');
  await page.getByTestId('hd-ticketrow').filter({ hasText: 'HD-000002' }).locator('button').click();
  await page.getByRole('radio', { name: '5 stars' }).click();
  await page.getByTestId('hd-send-rating').click();
  await expect(page.getByTestId('hd-ticket')).toContainText('You rated it 5 of 5.');
  await noOverflow();
  expect(errors).toEqual([]);
});
