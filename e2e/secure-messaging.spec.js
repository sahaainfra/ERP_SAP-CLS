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

// Part 05.03: secure end-to-end messaging. The licence review and the policy are approved by the people named in the chain; then two people and two devices of one of them talk, compare safety numbers and
// share an encrypted file; the database is searched for the words (T-01).
const act = async (request, c, roles, user, instanceId) => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked and fine' });
};
const POLICY = (extra = {}) => ({ enabled: true, creatorRoles: ['PD', 'PM', 'DIR'], maxGroupMembers: 10, maxDevicesPerUser: 5, allowAttachments: true, maxAttachmentMb: 10, defaultDisappearSeconds: 0, allowedDisappearSeconds: [0, 3600, 86400], metadataRetentionDays: 90, undeliveredRetentionDays: 14, screenshotWarning: true, effectiveFrom: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10), reason: 'Sensitive tender talks', ...extra });
const gate = async (request, c, sys, it, dir) => {
  const rev = await api(request, c, 'SYSADM', sys, 'post', '/sec/licences/reviews', { comment: 'Review of the end-to-end library and the open-source components' });
  await act(request, c, 'ITADM', it, rev.workflow.id);
  await act(request, c, 'DIR', dir, rev.workflow.id);
  const pol = await api(request, c, 'SYSADM', sys, 'post', '/sec/policy/changes', POLICY());
  await act(request, c, 'ITADM', it, pol.workflow.id);
};

test('AC-01 AC-05 FR-01 FR-07 the licence register and the policy: the gate is closed until the review is approved by the IT administrator and the director, then the policy is switched on by an approved change', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const tag = info.project.name === 'mobile' ? 'M' : 'D';
  const t = tag.toLowerCase();
  const c = await company(request, `SL${tag}`);
  const [sys, it, dir] = [`e2e-ssys${t}`, `e2e-sit${t}`, `e2e-sdir${t}`];
  people(c, [[sys, ['SYSADM'], 'Sam Admin'], [it, ['ITADM'], 'Ira IT'], [dir, ['DIR'], 'Dina Director']]);
  const a = await open(browser, info, c, 'SYSADM', sys, '/admin/licences');
  const errors = watch(a.page);
  await expect(a.page.getByRole('heading', { name: 'Open-Source Licence Register', level: 1 })).toBeVisible();
  await expect(a.page.getByTestId('licence-gate')).toContainText('not approved');
  await expect(a.page.getByTestId('lr-row').filter({ hasText: 'libsignal (Signal Protocol)' })).toContainText('AGPL-3.0-only');
  await a.page.getByTestId('lr-scan').click();
  await expect(a.page.getByTestId('lr-notice')).toContainText('component');
  await a.page.getByTestId('lr-q').fill('libsignal');
  await expect(a.page.getByTestId('lr-row')).toHaveCount(2); // libsignal and the Signal server
  await a.page.getByTestId('lr-q').fill('');
  // the policy cannot be switched on yet: the form says why and the server refuses
  const p0 = await open(browser, info, c, 'SYSADM', sys, '/admin/secure-messaging');
  await expect(p0.page.getByTestId('sp-licence')).toBeVisible();
  await expect(p0.page.getByTestId('sp-enabled')).toBeDisabled();
  // send the review from the page
  await a.page.getByTestId('lr-comment').fill('Review of the end-to-end library and the open-source components');
  await a.page.getByTestId('lr-review-send').click();
  await expect(a.page.getByTestId('lr-notice')).toContainText('sent for approval');
  await expect(a.page.getByTestId('lr-pending')).toBeVisible();
  const inst = (await api(request, c, 'SYSADM', sys, 'get', '/sec/licences')).pendingReview.instanceId;
  await act(request, c, 'ITADM', it, inst);
  await act(request, c, 'DIR', dir, inst);
  await a.page.reload();
  await expect(a.page.getByTestId('licence-gate')).toContainText('is approved');
  await expect(a.page.getByTestId('lr-review-row').first()).toContainText('Approved');
  await expect(a.page.getByTestId('lr-row').filter({ hasText: 'libsignal (Signal Protocol)' })).toContainText('Not allowed');
  await noOverflow(a.page);
  // the policy: the system administrator proposes, the IT administrator approves
  await p0.page.reload();
  await expect(p0.page.getByRole('heading', { name: 'Secure Messaging Policy', level: 1 })).toBeVisible();
  await expect(p0.page.getByTestId('sp-stance')).toContainText('cannot read');
  await p0.page.getByTestId('sp-enabled').check();
  await p0.page.getByTestId('sp-roles').fill('PD, PM, DIR');
  await p0.page.getByTestId('sp-reason').fill('Sensitive tender talks');
  await p0.page.getByTestId('sp-submit').click();
  await expect(p0.page.getByTestId('sp-notice')).toContainText('sent for approval');
  await expect(p0.page.getByTestId('sp-pending')).toBeVisible();
  const pol = (await api(request, c, 'SYSADM', sys, 'get', '/sec/policy')).pending.instanceId;
  await act(request, c, 'ITADM', it, pol);
  await p0.page.reload();
  await expect(p0.page.getByText('Secure messaging is on', { exact: false })).toBeVisible();
  await expect(p0.page.getByTestId('sp-history-row').first()).toContainText('In force');
  await noOverflow(p0.page);
  // the IT administrator sees the devices section; a person without the right does not see the page
  const i = await open(browser, info, c, 'ITADM', it, '/admin/secure-messaging');
  await expect(i.page.getByTestId('admin-devices')).toBeVisible();
  const n = await open(browser, info, c, 'SE', `e2e-sse${t}`, '/admin/licences');
  await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('AC-02 FR-02 FR-03 FR-04 FR-06 FR-08 T-01 T-02 T-03 a secure conversation across two devices: encrypted text and file, safety numbers that match, a warning when a device is added, only ciphertext in the database', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const t = tag.toLowerCase();
  const c = await company(request, `SC${tag}`);
  const [sys, it, dir, pd, pm] = [`e2e-csys${t}`, `e2e-cit${t}`, `e2e-cdir${t}`, `e2e-cpd${t}`, `e2e-cpm${t}`];
  people(c, [[sys, ['SYSADM'], 'Sam Admin'], [it, ['ITADM'], 'Ira IT'], [dir, ['DIR'], 'Dina Director'], [pd, ['PD'], 'Pooja Director'], [pm, ['PM'], 'Meera Manager']]);
  await gate(request, c, sys, it, dir);
  const secret = `Quote the bridge pier at floor price ${tag}7731`;

  // Meera sets up her first device from the Safety Number page
  const m1 = await open(browser, info, c, 'PM', pm, '/collab/safety-number');
  const errors = watch(m1.page);
  await expect(m1.page.getByRole('heading', { name: 'Safety Number Verification', level: 1 })).toBeVisible();
  await m1.page.getByTestId('device-setup').click();
  await expect(m1.page.getByTestId('device-row')).toHaveCount(1);
  await expect(m1.page.getByTestId('device-row')).toContainText('this browser');

  // Pooja starts a secure conversation from the New page (her device is set up on the way)
  const a = await open(browser, info, c, 'PD', pd, '/collab/messages/new');
  const ea = watch(a.page);
  await a.page.getByTestId('nc-kind').selectOption('SECURE');
  await expect(a.page.getByTestId('nc-secure-note')).toBeVisible();
  await a.page.getByTestId('nc-who').fill('Meera');
  await a.page.getByTestId(`pick-${pm}`).click();
  await a.page.getByTestId('nc-start').click();
  await expect(a.page.getByTestId('msg-conversation')).toHaveAttribute('data-secure', 'true');
  await expect(a.page.getByTestId('secure-banner')).toContainText('End-to-end encrypted');
  await expect(a.page.getByTestId('secure-notice')).toContainText('cannot read them');
  await a.page.getByTestId('compose-input').fill(secret);
  await a.page.getByTestId('compose-send').click();
  await expect(a.page.getByTestId('smsg').filter({ hasText: secret })).toBeVisible();
  // an encrypted file
  await a.page.getByTestId('compose-file').setInputFiles([{ name: 'pier-loads.txt', mimeType: 'text/plain', buffer: Buffer.from(`PIER LOADS ${tag} confidential 9912 kN`) }]);
  await expect(a.page.getByTestId('smsg-file')).toContainText('pier-loads.txt', { timeout: 20_000 });
  await noOverflow(a.page);

  // Meera: the list shows the lock and an unread count; the text and the file are decrypted on her device
  await m1.page.goto('/collab/messages');
  await expect(m1.page.getByTestId('secure-label').first()).toBeVisible({ timeout: 20_000 });
  await m1.page.locator('[data-testid^="conv-"]').first().click();
  await expect(m1.page.getByTestId('smsg').filter({ hasText: secret })).toBeVisible({ timeout: 20_000 });
  await expect(m1.page.getByTestId('smsg-file')).toBeVisible({ timeout: 40_000 });
  const dl = m1.page.waitForEvent('download');
  await m1.page.getByTestId('smsg-file').click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('pier-loads.txt');
  expect(await (await import('node:fs/promises')).readFile(await file.path(), 'utf8')).toBe(`PIER LOADS ${tag} confidential 9912 kN`);
  await expect(m1.page.getByTestId('secure-label').first()).toBeVisible();

  // T-01: neither the words nor the file's content are anywhere in the database
  const db = new DatabaseSync('data/e2e.sqlite', { readOnly: true });
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const table of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)) {
    for (const col of db.prepare(`PRAGMA table_info(${table})`).all().map((x) => x.name)) {
      for (const needle of [secret, `${tag}7731`, 'confidential 9912']) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE CAST("${col}" AS TEXT) LIKE ?`).get(`%${needle}%`).n, `${table}.${col}`).toBe(0);
    }
  }
  db.close();

  // safety numbers: both people see the same 60 digits
  const conv = new URL(a.page.url()).searchParams.get('c');
  await a.page.getByTestId('safety-link').click();
  await expect(a.page.getByTestId('safety-digits')).toBeVisible();
  const digitsA = (await a.page.getByTestId('safety-digits').innerText()).replace(/\D/g, '');
  expect(digitsA).toHaveLength(60);
  await a.page.getByTestId('safety-typed').fill(digitsA);
  await expect(a.page.getByTestId('safety-match')).toHaveText('It matches.');
  await a.page.getByTestId('safety-verify').click();
  await expect(a.page.getByText('you verified this number')).toBeVisible();
  await m1.page.goto(`/collab/safety-number?c=${conv}`);
  await expect(m1.page.getByTestId('safety-digits')).toBeVisible();
  expect((await m1.page.getByTestId('safety-digits').innerText()).replace(/\D/g, '')).toBe(digitsA);
  await noOverflow(a.page);

  // T-02: Meera sets up a second device (another browser profile): Pooja's next message is held back by a warning
  const m2 = await open(browser, info, c, 'PM', pm, '/collab/safety-number');
  await m2.page.getByTestId('device-setup').click();
  await expect(m2.page.getByTestId('device-row')).toHaveCount(2);
  await a.page.goto(`/collab/messages?c=${conv}`);
  await a.page.getByTestId('compose-input').fill('After the new device');
  await a.page.getByTestId('compose-send').click();
  await expect(a.page.getByTestId('key-change')).toContainText('safety number changed');
  await expect(a.page.getByTestId('smsg').filter({ hasText: 'After the new device' })).toHaveCount(0);
  await a.page.getByTestId('key-accept').click();
  await a.page.getByTestId('compose-send').click();
  await expect(a.page.getByTestId('smsg').filter({ hasText: 'After the new device' })).toBeVisible({ timeout: 20_000 });
  // both of Meera's devices receive it
  await m1.page.goto(`/collab/messages?c=${conv}`);
  await expect(m1.page.getByTestId('smsg').filter({ hasText: 'After the new device' })).toBeVisible({ timeout: 20_000 });
  await m2.page.goto(`/collab/messages?c=${conv}`);
  await expect(m2.page.getByTestId('smsg').filter({ hasText: 'After the new device' })).toBeVisible({ timeout: 20_000 });
  await expect(m2.page.getByTestId('smsg').filter({ hasText: secret })).toHaveCount(0); // the second device never had what was sent before it existed
  // Meera's reply reaches Pooja
  await m2.page.getByTestId('compose-input').fill('Understood');
  await m2.page.getByTestId('compose-send').click();
  await a.page.reload();
  await expect(a.page.getByTestId('smsg').filter({ hasText: 'Understood' })).toBeVisible({ timeout: 20_000 });
  await noOverflow(m2.page);
  expect([...errors, ...ea]).toEqual([]);
});
