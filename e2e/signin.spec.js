import { test, expect } from '@playwright/test';
import { counterAt, totpAt } from '../src/server/platform/identity/totp.js';
import { menu, signOut } from './shell-helpers.js';

// These tests run against the API in sign-in mode (AUTH_MODE=iam, port 3101, scripts/e2e_iam_server.mjs). Desktop and mobile share
// its database, so each uses its own company and users (suffix d and m).
test.use({ baseURL: 'http://localhost:3101' });
test.describe.configure({ mode: 'serial' });

const PW = 'Excavator-Test-9-Pw';
const state = { d: {}, m: {} };
const suf = (info) => (info.project.name === 'desktop' ? 'd' : 'm');
const code = (secret) => totpAt(secret, counterAt(Date.now()));

function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const noOverflow = async (page) => {
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};

/** The message shown for a failed sign-in, without the correlation ID that ends it. */
const failure = async (page) => ((await page.getByTestId('login-error').textContent()) ?? '').replace(/\s*\([0-9a-f-]{36}\)$/, '');

async function signIn(page, username, password = PW, { remember = false } = {}) {
  await page.getByLabel('Username, email or mobile').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  if (remember) await page.getByLabel(/Remember this device/).check();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

const api = (request, path, { token, data, method = 'POST', headers = {} } = {}) =>
  request.fetch(`/api/v1${path}`, { method, data, headers: { 'x-token-delivery': 'body', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

/** Enrol a privileged user through the API (the sign-in screen is covered by its own test) and return a live token and the backup codes. */
async function enrolViaApi(request, username, device = 'api-device-0001') {
  const first = await (await api(request, '/iam/auth/login', { data: { username, password: PW, deviceId: device, deviceName: 'API' } })).json();
  const ct = first.data.challengeToken;
  const begin = await (await api(request, '/iam/auth/mfa/enrol/begin', { data: { challengeToken: ct } })).json();
  const done = await (await api(request, '/iam/auth/mfa/enrol/confirm', { data: { challengeToken: ct, code: code(begin.data.secret), deviceId: device, deviceName: 'API' } })).json();
  return { token: done.data.accessToken, backupCodes: done.data.backupCodes };
}

test('Sign-in: the same message for every failure, a question after repeated failures, a lock, and English or Hindi', async ({ page }, info) => {
  const s = suf(info);
  const errors = watch(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveTitle(/ERP|Sign/i);

  await signIn(page, `lock-${s}`, 'wrong-Password-1');
  const known = await failure(page);
  await signIn(page, 'nobody-here', 'wrong-Password-1');
  await expect.poll(() => failure(page)).toBe(known);
  expect(known).not.toMatch(/exist|lock|disabled|password is wrong|unknown/i);

  await signIn(page, `lock-${s}`, 'wrong-Password-2');
  await signIn(page, `lock-${s}`, 'wrong-Password-3');
  // The question changes after every refusal; wait for the new one before answering it.
  const question = () => page.getByText(/What is \d+ \+ \d+\?/);
  const answer = async () => String(((await question().textContent()).match(/\d+/g) ?? []).reduce((a, n) => a + Number(n), 0));
  await expect(question()).toBeVisible();
  for (let i = 0; i < 2; i += 1) {
    const before = await question().textContent();
    await page.getByLabel(/Answer to continue/).fill(await answer());
    await signIn(page, `lock-${s}`, `wrong-Password-${i + 4}`);
    await expect(question()).not.toHaveText(before);
  }
  // locked: even the right password and a right answer get the same message
  await page.getByLabel(/Answer to continue/).fill(await answer());
  await signIn(page, `lock-${s}`, PW);
  await expect.poll(() => failure(page)).toBe(known);
  await expect(page.getByTestId('signed-in-as')).toHaveCount(0);

  await page.getByRole('button', { name: 'हिन्दी' }).click();
  await expect(page.getByRole('heading', { name: 'साइन इन करें' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('A privileged role must set up an authenticator before it gets in; later sign-ins ask for the second step', async ({ page }, info) => {
  const s = suf(info);
  const errors = watch(page);
  await page.goto('/');
  await signIn(page, `admin-${s}`);
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await expect(page.getByAltText('QR code for the authenticator app')).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('Code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(code(secret));
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByRole('heading', { name: 'Save your backup codes' })).toBeVisible();
  const codes = await page.getByTestId('backup-codes').locator('code').allTextContents();
  expect(codes).toHaveLength(10);
  state[s].backup = codes;
  await page.getByRole('button', { name: 'I have saved these codes' }).click();
  await expect(page.getByTestId('signed-in-as')).toHaveText(new RegExp(`Admin ${s}`, 'i'));
  await expect((await menu(page)).getByRole('link', { name: 'Authentication Policy' })).toBeVisible();

  await (await menu(page)).getByRole('link', { name: 'Security & MFA' }).click();
  await expect(page.getByRole('heading', { name: 'Security & MFA' })).toBeVisible();
  await expect(page.getByTestId('backup-left')).toHaveText('10');
  await expect(page.getByText('Set up', { exact: true }).first()).toBeVisible();

  await signOut(page);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await signIn(page, `admin-${s}`);
  await expect(page.getByRole('heading', { name: 'Second step' })).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await page.getByRole('button', { name: 'Use a backup code' }).click();
  await page.getByLabel('Backup code').fill(codes[0]);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByTestId('signed-in-as')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('signed-in-as')).toBeVisible(); // the session is picked up again from the cookie
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('My Sessions & Devices: remember a device, set a PIN, unlock with it; an administrator\'s forced sign-out ends the session at once', async ({ page, request }, info) => {
  const s = suf(info);
  const errors = watch(page);
  const it = await enrolViaApi(request, `itadm-${s}`);
  state[s].it = it.token;
  await page.goto('/');
  await signIn(page, `field-${s}`, PW, { remember: true });
  await expect(page.getByTestId('signed-in-as')).toBeVisible();

  await (await menu(page)).getByRole('link', { name: 'My Sessions' }).click();
  await expect(page.getByRole('heading', { name: 'My Sessions & Devices' })).toBeVisible();
  await expect(page.getByTestId('session-current')).toContainText('This session');
  await page.getByRole('button', { name: 'Set PIN' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/PIN \(4 to 8 digits\)/).fill('1234');
  await dialog.getByRole('button', { name: 'Save PIN' }).click();
  await expect(dialog.getByRole('alert')).toContainText(/run of digits/);
  await dialog.getByLabel(/PIN \(4 to 8 digits\)/).fill('4827');
  await dialog.getByRole('button', { name: 'Save PIN' }).click();
  await expect(page.getByTestId('sessions-notice')).toContainText('PIN saved');
  await expect(page.locator('[data-testid^=device-]').first()).toContainText('Set');

  await signOut(page);
  await expect(page.getByRole('heading', { name: 'Unlock with PIN' })).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill('4827');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('signed-in-as')).toBeVisible();

  // an administrator ends that session; the next thing the person does shows the sign-in screen
  const list = await (await api(request, `/iam/admin/sessions?filter[user]=field-${s}`, { token: it.token, method: 'GET' })).json();
  expect(list.data.length).toBeGreaterThan(0);
  for (const row of list.data) {
    expect((await api(request, `/iam/admin/sessions/${row.id}/revoke`, { token: it.token, data: { reason: 'lost phone reported' } })).status()).toBe(200);
  }
  // the next thing the person does shows the sign-in screen; a screen that already noticed (it asks the server often) shows it without that
  const signedOut = page.getByRole('status').filter({ hasText: 'You were signed out' });
  await page.locator('#sh-nav').getByRole('link', { name: 'Security & MFA' }).click({ timeout: 4000 }).catch(() => {});
  await expect(signedOut).toBeVisible({ timeout: 15_000 });
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Authentication Policy and Login History: a change is a request the other administrator approves; history, forced sign-out and unlock', async ({ page, request }, info) => {
  const s = suf(info);
  const errors = watch(page);
  // two sign-ins for watch-s from different devices and countries produce a suspicious-login alert
  const watchLogin = (device, country) => api(request, '/iam/auth/login', { data: { username: `watch-${s}`, password: PW, deviceId: device, deviceName: device }, headers: { 'x-geo-country': country } });
  expect((await watchLogin('device-home-watch', 'IN')).status()).toBe(200);
  expect((await watchLogin('device-away-watch', 'AE')).status()).toBe(200);

  await page.goto('/');
  await signIn(page, `admin-${s}`);
  await page.getByRole('button', { name: 'Use a backup code' }).click();
  await page.getByLabel('Backup code').fill(state[s].backup[1]);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByTestId('signed-in-as')).toBeVisible();

  await (await menu(page)).getByRole('link', { name: 'Authentication Policy' }).click();
  await expect(page.getByRole('heading', { name: 'Authentication Policy' })).toBeVisible();
  await expect(page.getByTestId('policy-session').locator('input[name="session.idleMinutes"]')).toHaveValue('30');
  await page.getByTestId('policy-session').locator('input[name="session.idleMinutes"]').fill('20');
  await page.getByRole('button', { name: 'Request change' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('policy-diff')).toContainText('session.idleMinutes');
  await dialog.getByLabel(/Reason/).fill('tighten idle sessions for the audit');
  await dialog.getByRole('button', { name: 'Request change' }).click();
  await expect(page.getByTestId('policy-notice')).toContainText('Change requested');
  await expect(page.getByText('waiting for approval')).toBeVisible();

  const reqs = await (await api(request, '/core/change-requests?filter[type]=auth_policy_change', { token: state[s].it, method: 'GET' })).json();
  const pending = reqs.data.find((r) => r.status === 'SUBMITTED');
  expect(pending.chain).toEqual(['ITADM']);
  expect((await api(request, `/core/change-requests/${pending.id}/act`, { token: state[s].it, data: { action: 'approve', comment: 'ok' } })).status()).toBe(200);
  await page.reload();
  await (await menu(page)).getByRole('link', { name: 'Authentication Policy' }).click();
  await expect(page.getByTestId('policy-session').locator('input[name="session.idleMinutes"]')).toHaveValue('20');
  await expect(page.getByRole('cell', { name: /change approved/ }).first()).toBeVisible();

  await (await menu(page)).getByRole('link', { name: 'Login History' }).click();
  await expect(page.getByRole('heading', { name: 'Login History' })).toBeVisible();
  await page.getByPlaceholder('Exact username').fill(`watch-${s}`);
  await page.locator('#main select').first().selectOption('suspicious');
  const row = page.getByTestId(/^event-/).first();
  await expect(row).toContainText(`watch-${s}`);
  await expect(row).toContainText(/new device.*new country.*impossible travel/);
  await page.locator('#main select').first().selectOption('');
  await page.getByPlaceholder('Exact username').fill(`lock-${s}`);
  await expect(page.getByTestId(/^event-/).filter({ hasText: 'Locked' }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Active sessions' }).click();
  await page.getByRole('button', { name: new RegExp(`Force sign-out of watch-${s}`) }).first().click();
  await page.getByRole('dialog').getByLabel(/Reason/).fill('suspicious sign-in being checked');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign them out' }).click();
  await expect(page.getByTestId('sessions-admin-notice')).toContainText(`watch-${s} was signed out`);

  await page.getByRole('tab', { name: 'Users' }).click();
  await expect(page.getByTestId(`user-admin-${s}`)).toContainText('Enrolled');
  await expect(page.getByTestId(`user-itadm-${s}`)).toContainText('Enrolled');
  await expect(page.getByTestId(`user-field-${s}`)).toContainText('Not set up');
  await expect(page.getByTestId(`user-lock-${s}`)).toContainText('Locked');
  await page.getByRole('button', { name: `Unlock lock-${s}` }).click();
  await page.getByRole('dialog').getByLabel(/Reason/).fill('identity confirmed by phone');
  await page.getByRole('dialog').getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByTestId('users-notice')).toContainText(`lock-${s} can sign in again`);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Forgotten password gives the same answer for any name; a project manager has no security administration; a signed-out visitor sees only the sign-in', async ({ page }, info) => {
  const s = suf(info);
  const errors = watch(page);
  await page.goto('/admin/security/policy');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0); // a signed-out visitor has no menu

  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Username, email or mobile').fill(`reset-${s}@example.com`);
  await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page.getByTestId('login-info')).toContainText('If that account exists');
  const message = await page.getByTestId('login-info').textContent();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Username, email or mobile').fill('nobody@example.com');
  await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page.getByTestId('login-info')).toHaveText(message ?? '');
  await page.getByLabel('Reset code from your email').fill('AAAAA-AAAAA');
  await page.getByLabel('New password').fill('Another-Passw0rd-Zulu');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByTestId('login-error')).toContainText(/not right or has expired/);
  await page.getByRole('button', { name: 'Back' }).click();

  await signIn(page, `spare-${s}`);
  await expect(page.getByTestId('signed-in-as')).toBeVisible();
  await expect((await menu(page)).getByRole('link', { name: 'Authentication Policy' })).toHaveCount(0);
  await page.goto('/admin/security/policy');
  await expect(page.getByTestId('no-permission')).toBeVisible();
  await page.goto('/admin/security/login-history');
  await expect(page.getByTestId('no-permission')).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});
