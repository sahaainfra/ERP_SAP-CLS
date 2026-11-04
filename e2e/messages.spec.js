import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 05.01: the Messages app: a direct conversation started from the New page, messages with a file and a record card, the other person's list with an unread count, a reply
// that arrives without a reload, the three-pane layout on a computer and the single pane on a phone, the pop-out window and the dock over another page.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const api = async (request, c, roles, user, method, path, data) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).data;
};
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/number-series', { docType: 'SAMPLE_DOC', name: 'Sample documents', prefix: 'SMP', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' });
  return id;
}
// the people of the company: written straight into the throw-away database of the run (the dev-header mode has no sign-in to make them)
function people(c, list) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [name, roles, display] of list) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, name, display, JSON.stringify(roles), `${name}@example.com`);
  db.close();
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

test('AC-01 AC-02 FR-02 FR-03 FR-04 FR-07 one Messages app: a direct conversation, a file and a record card, unread counts, a reply in real time, panes by width, the pop-out window and the dock', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const tag = info.project.name === 'mobile' ? 'M' : 'D';
  const phone = info.project.name === 'mobile';
  const c = await company(request, `MSG${tag}`);
  const project = await api(request, c, 'PM', 'e2e-pm', 'post', '/iam/org/projects', { code: `MS${tag}1`, name: 'Ring Road', type: 'ROAD' });
  const doc = await api(request, c, 'PD', 'e2e-pd', 'post', '/eng/sample-docs', { title: 'Shuttering for the bridge', amount: '12000.00', projectId: project.id });
  const pd = `e2e-pd${tag.toLowerCase()}`;
  const pm = `e2e-pm${tag.toLowerCase()}`;
  people(c, [[pd, ['PD'], 'Pooja Director'], [pm, ['PM'], 'Meera Manager']]);

  const a = await open(browser, info, c, 'PD', pd, '/collab/messages');
  const errors = watch(a.page);
  await expect(a.page.getByRole('heading', { name: 'Messages', level: 1 })).toBeVisible();
  await expect(a.page.getByTestId('messages')).toHaveAttribute('data-layout', phone ? 'phone' : 'desktop');
  await expect(a.page.getByText('No conversations yet')).toBeVisible();
  // a new conversation with a person
  await a.page.getByTestId('msg-new').click();
  await expect(a.page.getByRole('heading', { name: 'New conversation', level: 1 })).toBeVisible();
  await a.page.getByTestId('nc-who').fill('Meera');
  await a.page.getByTestId(`pick-${pm}`).click();
  await a.page.getByTestId('nc-start').click();
  await expect(a.page.getByTestId('msg-conversation')).toBeVisible();
  await expect(a.page.getByRole('heading', { name: 'Meera Manager' })).toBeVisible();
  // the first message, then a file and a record card
  await a.page.getByTestId('compose-input').fill('Slab pour tomorrow morning');
  await a.page.getByTestId('compose-send').click();
  await expect(a.page.getByTestId('msg').filter({ hasText: 'Slab pour tomorrow morning' })).toBeVisible();
  await a.page.getByTestId('compose-file').setInputFiles([{ name: 'site.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(a.page.getByRole('list', { name: 'Attached' })).toContainText('site.png');
  await a.page.getByTestId('compose-record').click();
  await a.page.getByTestId('picker-q').fill('bridge');
  await a.page.getByTestId('picker-row').first().click();
  await a.page.getByTestId('compose-input').fill('Please check the drawing and the document');
  await a.page.getByTestId('compose-send').click();
  const card = a.page.getByTestId('record-card').first();
  await expect(card).toContainText('Shuttering for the bridge');
  await expect(card).toHaveAttribute('data-restricted', 'false');
  await expect(a.page.getByTestId('msg-thread').getByTestId('msg-file')).toContainText('site.png');
  if (!phone) await expect(a.page.getByTestId('msg-details-panel')).toBeVisible(); else await expect(a.page.getByTestId('msg-details-panel')).toHaveCount(0);
  await noOverflow(a.page);

  // the other person: an unread count, the messages, a reply
  const b = await open(browser, info, c, 'PM', pm, '/collab/messages');
  const eb = watch(b.page);
  await expect(b.page.getByTestId('msg-list')).toContainText('Pooja Director');
  await expect(b.page.locator('[data-testid^="unread-"]').first()).toHaveText('2');
  await b.page.locator('[data-testid^="conv-"]').first().click();
  await expect(b.page.getByTestId('msg').filter({ hasText: 'Slab pour tomorrow morning' })).toBeVisible();
  await expect(b.page.getByTestId('record-card').first()).toContainText('Shuttering for the bridge');
  await expect(b.page.locator('[data-testid^="unread-"]')).toHaveCount(0);
  await b.page.getByTestId('compose-input').fill('Understood, I will be there');
  await b.page.getByTestId('compose-send').click();
  // it arrives on the first person's screen without a reload
  await expect(a.page.getByTestId('msg').filter({ hasText: 'Understood, I will be there' })).toBeVisible({ timeout: 20_000 });
  // reaction and deletion
  await b.page.getByTestId('msg').filter({ hasText: 'Understood' }).getByTestId('msg-more').click();
  await b.page.getByTestId('msg-delete').click();
  await expect(b.page.getByText('message deleted').first()).toBeVisible();
  await expect(a.page.getByText('message deleted').first()).toBeVisible({ timeout: 20_000 });
  await a.page.getByTestId('msg').filter({ hasText: 'Slab pour tomorrow' }).getByTestId('msg-more').click();
  await a.page.getByRole('menuitem', { name: '👍' }).click();
  await expect(a.page.getByRole('button', { name: '👍 1' })).toBeVisible();
  await noOverflow(b.page);
  expect(eb).toEqual([]);

  if (phone) {
    // one pane: back to the list
    await a.page.getByTestId('msg-back').click();
    await expect(a.page.getByTestId('msg-list')).toBeVisible();
    await expect(a.page.getByTestId('msg-conversation')).toHaveCount(0);
    await noOverflow(a.page);
  } else {
    // the small window and the dock over another page
    await a.page.getByTestId('msg-popout').click();
    await a.page.goto('/home');
    await expect(a.page.getByTestId('minichat')).toBeVisible();
    await a.page.getByTestId('minichat').getByTestId('compose-input').fill('From the small window');
    await a.page.getByTestId('minichat').getByTestId('compose-send').click();
    await expect(b.page.getByTestId('msg').filter({ hasText: 'From the small window' })).toBeVisible({ timeout: 20_000 });
    await expect(a.page.getByTestId('dock-open')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('AC-01 a person who is not in a conversation does not see it, and cannot open it by its address', async ({ browser, request }, info) => {
  const tag = info.project.name === 'mobile' ? 'M' : 'D';
  const c = await company(request, `MSN${tag}`);
  const a = `e2e-an${tag.toLowerCase()}`; const b = `e2e-bn${tag.toLowerCase()}`; const x = `e2e-xn${tag.toLowerCase()}`;
  people(c, [[a, ['PD'], 'Anil Director'], [b, ['PM'], 'Bina Manager'], [x, ['SE'], 'Xavier Engineer']]);
  const made = await api(request, c, 'PD', a, 'post', '/msg/conversations', { type: 'DIRECT', members: [b] });
  await api(request, c, 'PD', a, 'post', `/msg/conversations/${made.id}/messages`, { body: 'Private plan' });
  const { page } = await open(browser, info, c, 'SE', x, `/collab/messages?c=${made.id}`);
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'Messages', level: 1 })).toBeVisible();
  await expect(page.getByText('Private plan')).toHaveCount(0);
  await expect(page.getByTestId('msg-list')).not.toContainText('Anil Director');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});
