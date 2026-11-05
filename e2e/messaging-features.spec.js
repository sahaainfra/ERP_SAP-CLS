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

test('AC-01 AC-03 AC-04 FR-02 FR-03 FR-05 receipts, search with a jump to the message, a star, a pin, and no page overflow', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const tag = info.project.name === 'mobile' ? 'M' : 'D';
  const c = await company(request, `MF${tag}`);
  const pd = `e2e-fpd${tag.toLowerCase()}`;
  const pm = `e2e-fpm${tag.toLowerCase()}`;
  people(c, [[pd, ['PD'], 'Pooja Director'], [pm, ['PM'], 'Meera Manager']]);
  const conv = await api(request, c, 'PD', pd, 'post', '/msg/conversations', { type: 'DIRECT', members: [pm] });
  await api(request, c, 'PD', pd, 'post', `/msg/conversations/${conv.id}/messages`, { body: 'Cube test result for the raft is ready' });

  const a = await open(browser, info, c, 'PD', pd, '/collab/messages');
  const errors = watch(a.page);
  await a.page.getByTestId(`conv-${conv.id}`).click();
  await expect(a.page.getByTestId('msg').filter({ hasText: 'Cube test result' })).toBeVisible();
  // the other person reads: one tick turns to read
  const b = await open(browser, info, c, 'PM', pm, '/collab/messages');
  await b.page.getByTestId(`conv-${conv.id}`).click();
  await expect(b.page.getByTestId('msg').filter({ hasText: 'Cube test result' })).toBeVisible();
  await expect(a.page.getByTestId('msg-ticks').first()).toHaveClass(/is-read/, { timeout: 20_000 });
  // search for a word, then jump to the message
  if (info.project.name === 'mobile') await a.page.getByTestId('msg-back').click();
  await a.page.locator('#msg-q').fill('raft');
  await expect(a.page.getByTestId('search-hit').first()).toContainText('raft', { timeout: 15_000 });
  await a.page.getByTestId('search-hit').first().click();
  await expect(a.page.getByTestId('msg').filter({ hasText: 'Cube test result' })).toBeVisible();
  // star and pin
  await a.page.getByTestId('msg').filter({ hasText: 'Cube test result' }).getByTestId('msg-more').click();
  await a.page.getByTestId('msg-star').click();
  await a.page.getByTestId('msg').filter({ hasText: 'Cube test result' }).getByTestId('msg-more').click();
  await a.page.getByTestId('msg-pin').click();
  await expect(a.page.getByTestId('pins')).toContainText('Cube test result');
  await noOverflow(a.page);
  expect(errors).toEqual([]);
});

test('AC-05 FR-09 Messaging Settings: a change waits for a second person, the history lists it', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const tag = info.project.name === 'mobile' ? 'M' : 'D';
  const c = await company(request, `MS${tag}`);
  const a = await open(browser, info, c, 'SYSADM', `e2e-sys${tag.toLowerCase()}`, '/admin/messaging');
  const errors = watch(a.page);
  await expect(a.page.getByRole('heading', { name: 'Messaging Settings', level: 1 })).toBeVisible();
  await a.page.getByTestId('ms-editWindowMinutes').fill('30');
  await a.page.getByTestId('ms-reason').fill('Longer window agreed with the director');
  await a.page.getByTestId('ms-submit').click();
  await expect(a.page.getByTestId('ms-notice')).toContainText('sent for approval');
  await expect(a.page.getByTestId('ms-pending')).toBeVisible();
  await expect(a.page.getByTestId('ms-history-row').first()).toContainText('Longer window');
  await noOverflow(a.page);
  expect(errors).toEqual([]);
});
