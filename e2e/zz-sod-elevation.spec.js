import { test, expect } from '@playwright/test';
import { counterAt, totpAt } from '../src/server/platform/identity/totp.js';
import { menu } from './shell-helpers.js';

// Elevated access, signed in for real (port 3101, scripts/e2e_iam_server.mjs): a project manager asks for the auditor role for an hour,
// the IT administrator approves, the access appears; the person then sees the auditor's pages. Runs last (sign-in is limited per minute).
test.use({ baseURL: 'http://localhost:3101' });
test.describe.configure({ mode: 'serial' });

const PW = 'Excavator-Test-9-Pw';
const suf = (info) => (info.project.name === 'desktop' ? 'd' : 'm');
const api = (request, path, { token, data, method = 'POST' } = {}) =>
  request.fetch(`http://localhost:3101/api/v1${path}`, { method, data, headers: { 'x-token-delivery': 'body', 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) } });

async function enrolledToken(request, username) {
  const device = { deviceId: `device-${username}-0003`, deviceName: 'E2E' };
  let res = await api(request, '/iam/auth/login', { data: { username, password: PW, ...device } });
  for (let i = 0; i < 14 && res.status() === 429; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    res = await api(request, '/iam/auth/login', { data: { username, password: PW, ...device } });
  }
  const first = await res.json();
  const begin = await (await api(request, '/iam/auth/mfa/enrol/begin', { data: { challengeToken: first.data.challengeToken } })).json();
  const done = await (await api(request, '/iam/auth/mfa/enrol/confirm', { data: { challengeToken: first.data.challengeToken, code: totpAt(begin.data.secret, counterAt(Date.now())), ...device } })).json();
  return done.data.accessToken;
}

test('a project manager asks for the auditor role, the IT administrator approves, and the access appears and is logged', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const s = suf(info);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await page.getByLabel('Username, email or mobile').fill(`elev-${s}`);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect((await menu(page)).getByRole('link', { name: 'Request Elevated Access' })).toBeVisible();
  await expect((await menu(page)).getByRole('link', { name: 'SoD Violations' })).toHaveCount(0);
  await (await menu(page)).getByRole('link', { name: 'Request Elevated Access' }).click();
  await expect(page.getByRole('heading', { name: 'Request Elevated Access' })).toBeVisible();
  await page.locator('select[name=roleId]').selectOption({ label: 'AUD - Internal Auditor' });
  await page.locator('input[name=hours]').fill('1');
  await page.locator('textarea[name=reason]').fill('Investigating a duplicate payment query');
  await page.getByRole('button', { name: 'Send the request' }).click();
  await expect(page.getByTestId('elevation-notice')).toContainText('will decide');
  await expect(page.locator('[data-testid^=elevation-]').filter({ hasText: 'Waiting for approval' }).first()).toBeVisible();

  // asking is not having
  await expect((await menu(page)).getByRole('link', { name: 'SoD Violations' })).toHaveCount(0);

  // the IT administrator approves through the API, as the approvals page would
  const it = await enrolledToken(request, `elevit-${s}`);
  const list = await (await api(request, '/iam/elevations?filter[awaiting]=true', { token: it, method: 'GET' })).json();
  const mine = list.data.find((e) => e.username === `elev-${s}`);
  expect(mine, JSON.stringify(list)).toBeTruthy();
  const done = await api(request, `/iam/elevations/${mine.id}/decision`, { token: it, data: { action: 'approve', comment: 'ok for the incident' } });
  expect(done.status(), await done.text()).toBe(200);

  // the access appears, with its end time and the auditor's pages
  await page.reload();
  const row = page.getByTestId(`elevation-${mine.id}`);
  await expect(row).toContainText('Active');
  await expect(row).toContainText('left');
  await expect((await menu(page)).getByRole('link', { name: 'SoD Violations' })).toBeVisible();
  await (await menu(page)).getByRole('link', { name: 'SoD Violations' }).click();
  await expect(page.getByRole('heading', { name: 'Violations & Dormant Accounts' })).toBeVisible();

  // everything done while elevated is logged
  await (await menu(page)).getByRole('link', { name: 'Request Elevated Access' }).click();
  await page.getByRole('button', { name: `Open request ${mine.id}` }).click();
  await expect(page.getByTestId('elevation-detail')).toContainText('sod-violations');

  // the administrator revokes it; the access ends at once
  const revoked = await api(request, `/iam/elevations/${mine.id}/revoke`, { token: it, data: { reason: 'The query was resolved' } });
  expect(revoked.status(), await revoked.text()).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: `Open request ${mine.id}` }).waitFor();
  await expect(page.getByTestId(`elevation-${mine.id}`)).toContainText('Revoked');
  await expect((await menu(page)).getByRole('link', { name: 'SoD Violations' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
