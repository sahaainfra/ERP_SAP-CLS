import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 05.01: the Messages app: a direct conversation started from the New page, messages with a file and a record card, the other person's list with an unread count, a reply
// that arrives without a reload, the three-pane layout on a computer and the single pane on a phone, the pop-out window and the dock over another page.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
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

// Screenshots of the 05.03 pages for docs/erp/screenshots/secure. Only with SHOTS=1; the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/secure';
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


test('screenshots of the secure messaging pages', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const t = tag.toLowerCase();
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, `SS${tag}`);
  const [sys, it, dir, pd, pm] = [`shot-ssys${t}`, `shot-sit${t}`, `shot-sdir${t}`, `shot-spd${t}`, `shot-spm${t}`];
  people(c, [[sys, ['SYSADM'], 'Sam Admin'], [it, ['ITADM'], 'Ira IT'], [dir, ['DIR'], 'Dina Director'], [pd, ['PD'], 'Pooja Director'], [pm, ['PM'], 'Meera Manager']]);
  const a = await open(browser, info, c, 'SYSADM', sys, '/admin/licences');
  await expect(a.page.getByTestId('licence-gate')).toContainText('not approved');
  await a.page.getByTestId('lr-scan').click();
  await expect(a.page.getByTestId('lr-notice')).toBeVisible();
  await a.page.screenshot({ path: `${OUT}/01-licence-register-before-approval${sfx}.png` });
  await gate(request, c, sys, it, dir);
  await a.page.reload();
  await expect(a.page.getByTestId('licence-gate')).toContainText('is approved');
  await a.page.screenshot({ path: `${OUT}/02-licence-register-approved${sfx}.png` });
  const p = await open(browser, info, c, 'SYSADM', sys, '/admin/secure-messaging');
  await expect(p.page.getByTestId('sp-enabled')).toBeChecked();
  await p.page.waitForTimeout(500);
  await p.page.screenshot({ path: `${OUT}/03-secure-messaging-policy${sfx}.png` });
  const m = await open(browser, info, c, 'PM', pm, '/collab/safety-number');
  await m.page.getByTestId('device-setup').click();
  await expect(m.page.getByTestId('device-row')).toHaveCount(1);
  const n = await open(browser, info, c, 'PD', pd, '/collab/messages/new');
  await n.page.getByTestId('nc-kind').selectOption('SECURE');
  await n.page.getByTestId('nc-who').fill('Meera');
  await n.page.screenshot({ path: `${OUT}/04-new-secure-conversation${sfx}.png` });
  await n.page.getByTestId(`pick-${pm}`).click();
  await n.page.getByTestId('nc-start').click();
  await expect(n.page.getByTestId('msg-conversation')).toHaveAttribute('data-secure', 'true');
  await n.page.getByTestId('compose-input').fill('Quote the bridge pier at the floor price');
  await n.page.getByTestId('compose-send').click();
  await expect(n.page.getByTestId('smsg')).toBeVisible();
  await n.page.waitForTimeout(500);
  await n.page.screenshot({ path: `${OUT}/05-secure-conversation${sfx}.png` });
  const conv = new URL(n.page.url()).searchParams.get('c');
  await n.page.goto(`/collab/safety-number?c=${conv}`);
  await expect(n.page.getByTestId('safety-digits')).toBeVisible();
  await n.page.screenshot({ path: `${OUT}/06-safety-number${sfx}.png`, fullPage: true });
  const m2 = await open(browser, info, c, 'PM', pm, '/collab/safety-number');
  await m2.page.getByTestId('device-setup').click();
  await expect(m2.page.getByTestId('device-row')).toHaveCount(2);
  await n.page.goto(`/collab/messages?c=${conv}`);
  await n.page.getByTestId('compose-input').fill('After the new device');
  await n.page.getByTestId('compose-send').click();
  await expect(n.page.getByTestId('key-change')).toBeVisible();
  await n.page.screenshot({ path: `${OUT}/07-key-change-warning${sfx}.png` });
  await n.page.getByTestId('key-accept').click();
  const list = await open(browser, info, c, 'PM', pm, '/collab/messages');
  await expect(list.page.getByTestId('secure-label').first()).toBeVisible({ timeout: 20_000 });
  await list.page.screenshot({ path: `${OUT}/08-messages-list-with-secure-label${sfx}.png` });
});
