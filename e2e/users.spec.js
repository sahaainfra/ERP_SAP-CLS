import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { counterAt, totpAt } from '../src/server/platform/identity/totp.js';
import { menu } from './shell-helpers.js';

// The first test runs in development-header mode (port 3100), each project in its own company created through the API. The
// others run against the sign-in server (port 3101, scripts/e2e_iam_server.mjs), each project with its own people (suffix d and m).
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const suf = (info) => pick(info, 'd', 'm');
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
const PW = 'Excavator-Test-9-Pw';
const NEW_PW = 'Culvert-Pour-47-Slab';

async function newCompany(request, code) {
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-sys'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id;
}

function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (409|422|410)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const noOverflow = async (page) => {
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};

test('Users: invite, find, filter, save a view, import with row errors, hand over and deactivate', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'USRDESK', 'USRMOB'));
  const errors = watch(page);
  const t = suf(info);
  const n = pick(info, 0, 1);
  const anil = `anil.${t}`;
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: 'e2e-hr', roles: 'HRMGR', company: String(company) });
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Users/);
  await expect(page.getByRole('heading', { name: 'No users' })).toBeVisible();

  // invite, with a duplicate warning before the second person is saved
  await page.getByRole('button', { name: 'Invite user' }).first().click();
  await page.locator('dialog[open] input[name=displayName]').fill('Anil Verma');
  await page.locator('dialog[open] input[name=email]').fill(`${anil}@example.com`);
  await page.locator('dialog[open] input[name=mobile]').fill(`98765 4321${n}`);
  await page.locator('dialog[open] input[name=employeeCode]').fill(`E-100${n}`);
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByTestId('users-notice')).toContainText(`Anil Verma (${anil}) was created as Invited`);
  await expect(page.getByTestId(`user-row-${anil}`)).toContainText('Invited');

  await page.getByRole('button', { name: 'Invite user' }).first().click();
  await page.locator('dialog[open] input[name=displayName]').fill('Anil Again');
  await page.locator('dialog[open] input[name=email]').fill(`${anil.toUpperCase()}@example.com`);
  await page.locator('dialog[open] input[name=mobile]').click();
  await expect(page.getByTestId('duplicate-warning')).toContainText('matches Anil Verma');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.locator('dialog[open]')).toContainText('Already used by Anil Verma');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Invite user' }).first().click();
  await page.locator('dialog[open] input[name=displayName]').fill('Bela Shah');
  await page.locator('dialog[open] input[name=mobile]').fill(`912345678${n}`);
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByTestId(`user-row-u912345678${n}`)).toContainText('Invited');

  // search, filter, sort, columns, saved view, export
  await page.getByRole('searchbox', { name: 'Search users' }).fill('bela');
  await expect(page.getByTestId(`user-row-${anil}`)).toHaveCount(0);
  await expect(page.getByTestId(`user-row-u912345678${n}`)).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search users' }).fill('');
  await page.locator('select[aria-label="Status"]').selectOption('ACTIVE');
  await expect(page.getByRole('heading', { name: 'No users' })).toBeVisible();
  await expect(page.getByText('Nothing matches those filters.')).toBeVisible();
  await page.locator('select[aria-label="Status"]').selectOption('INVITED');
  await expect(page.getByTestId(`user-row-${anil}`)).toBeVisible();
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.locator('dialog[open] input[name=name]').fill('Waiting to join');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('select[aria-label="Status"]').selectOption('');
  await page.getByLabel('Saved views').selectOption('Waiting to join');
  await expect(page.locator('select[aria-label="Status"]')).toHaveValue('INVITED');
  if (info.project.name === 'desktop') {
    await page.getByRole('button', { name: /^Name/ }).click();
    await expect(page.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'descending');
  }
  await page.getByText('Columns', { exact: true }).click();
  await page.getByRole('group', { name: 'Choose columns' }).getByLabel('Email').check();
  await expect(page.getByRole('group', { name: 'Choose columns' }).getByLabel('Email')).toBeChecked();
  await page.getByText('Columns', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('users.csv');

  // import: a file with a duplicate and a bad mobile is checked, refused as a whole, then imported without the wrong rows
  await page.getByRole('button', { name: 'Import users' }).click();
  const csv = ['name,email,mobile', `Chandra Rao,chandra.${t}@example.com,981111111${n}`, `Anil Verma,${anil}@example.com,982222222${n}`, `Dev Patel,dev.${t}@example.com,123`, `Esha Nair,esha.${t}@example.com,983333333${n}`].join('\n');
  await page.getByTestId('import-text').fill(csv);
  await page.getByRole('button', { name: 'Check the file' }).click();
  await expect(page.getByTestId('import-summary')).toContainText('2 of 4 rows are ready; 2 have problems');
  await expect(page.getByTestId('import-error')).toHaveCount(2);
  await expect(page.getByTestId('import-error').first()).toContainText('already used by Anil Verma');
  await expect(page.getByRole('button', { name: /^Import \d+ user/ })).toBeDisabled();
  await page.getByLabel('Import only the valid rows').check();
  await page.getByLabel('Send invitations after importing').uncheck();
  await page.getByRole('button', { name: 'Import 2 user(s)' }).click();
  await expect(page.getByTestId('users-notice')).toContainText('Imported 2 user(s) as Invited; 2 row(s) skipped');
  await page.locator('select[aria-label="Status"]').selectOption('');
  await expect(page.getByTestId(`user-row-chandra.${t}`)).toBeVisible();
  await expect(page.getByTestId(`user-row-esha.${t}`)).toBeVisible();

  // bulk: the two people created above were invited when created, so a second send is refused for the pause; the imported pair is invited
  await page.getByLabel('Select Chandra Rao').check();
  await page.getByLabel('Select Esha Nair').check();
  await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');
  await page.getByRole('button', { name: 'Send invitations' }).click();
  await expect(page.getByTestId('users-notice')).toContainText('Invited 2 of 2');
  await page.getByLabel('Select Chandra Rao').check();
  await page.getByRole('button', { name: 'Send invitations' }).click();
  await expect(page.getByTestId('bulk-result')).toContainText('Wait half a minute');
  await page.getByLabel('Select Chandra Rao').check();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);

  // one person: details, a role request, the approval, and the deactivation wizard
  await page.getByRole('link', { name: 'Anil Verma' }).click();
  await expect(page.getByRole('heading', { name: 'Anil Verma', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
  await expect(page.getByRole('tabpanel')).toContainText('Waiting for the employee master');
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.locator('dialog[open] input[name=displayName]').fill('Anil K Verma');
  await page.locator('dialog[open] textarea[name=reason]').fill('Added the middle initial');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Anil K Verma', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Request a role' }).click();
  await page.locator('dialog[open]').getByLabel(/Project manager/).check();
  await page.locator('dialog[open] textarea[name=reason]').fill('Joins the Pune team as a site PM');
  await page.getByRole('button', { name: 'Raise the request' }).click();
  await expect(page.getByTestId('user-notice')).toContainText('needs SYSADM to approve');
  await expect(page.getByRole('tabpanel')).toContainText('waiting for a decision');
  const list = await (await request.get('/api/v1/core/change-requests?filter[type]=user_role_assignment', { headers: H('SYSADM', company, 'e2e-sys') })).json();
  const pending = list.data.find((r) => r.status === 'SUBMITTED');
  const own = await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: H('HRMGR', company, 'e2e-hr'), data: { action: 'approve' } });
  expect(own.status(), 'the requester cannot approve').toBe(403);
  expect((await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: H('SYSADM', company, 'e2e-sys'), data: { action: 'approve', comment: 'checked and fine' } })).status()).toBe(200);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByRole('tab', { name: 'Assignments' }).click();
  await expect(page.getByTestId('role-list')).toContainText('Project manager');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Roles granted after approval');
  await page.getByRole('tab', { name: 'Login history' }).click();
  await expect(page.getByRole('heading', { name: 'No sign-ins yet' })).toBeVisible();

  await page.getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByTestId('no-blockers')).toBeVisible();
  await page.locator('dialog[open] textarea[name=reason]').fill('Offer was withdrawn');
  await page.getByRole('button', { name: 'Deactivate', exact: true }).last().click();
  await expect(page.getByTestId('user-notice')).toContainText('Anil K Verma is deactivated');
  await expect(page.getByTestId('user-status')).toContainText('Deactivated');
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await page.locator('dialog[open] textarea[name=reason]').fill('Offer was renewed');
  await page.getByRole('button', { name: 'Reactivate', exact: true }).last().click();
  await expect(page.getByTestId('user-status')).toContainText('Invited');

  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Users: a role that only reads is not offered management, and a person without a role sees no users', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'USRRO', 'USRROM'));
  await request.post('/api/v1/iam/users', { headers: H('HRMGR', company, 'e2e-hr'), data: { displayName: 'Ravi Menon', email: `ravi.${suf(info)}@example.com` } });
  const errors = watch(page);
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: 'e2e-it', roles: 'ITADM', company: String(company) });
  await page.goto('/admin/users');
  await expect(page.getByTestId(`user-row-ravi.${suf(info)}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite user' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Import users' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Ravi Menon' }).click();
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request a role' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
  await expect(page.getByRole('tabpanel')).toContainText('Not set');
  expect(errors).toEqual([]);
});

// ---- sign-in mode ----
const api = (request, path, { token, data, method = 'POST' } = {}) =>
  request.fetch(`http://localhost:3101/api/v1${path}`, { method, data, headers: { 'x-token-delivery': 'body', 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) } });

async function tokenOf(request, username, { enrol = false } = {}) {
  const device = { deviceId: `device-${username}-0001`, deviceName: 'E2E' };
  // sign-in is limited to 30 a minute per address, and the sign-in spec before this one uses most of that
  let res = await api(request, '/iam/auth/login', { data: { username, password: PW, ...device } });
  for (let i = 0; i < 14 && res.status() === 429; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    res = await api(request, '/iam/auth/login', { data: { username, password: PW, ...device } });
  }
  const first = await res.json();
  if (!enrol) return first.data.accessToken;
  const ct = first.data.challengeToken;
  const begin = await (await api(request, '/iam/auth/mfa/enrol/begin', { data: { challengeToken: ct } })).json();
  const done = await (await api(request, '/iam/auth/mfa/enrol/confirm', { data: { challengeToken: ct, code: totpAt(begin.data.secret, counterAt(Date.now())), ...device } })).json();
  return done.data.accessToken;
}

test.describe('Invitation to access', () => {
  test.use({ baseURL: 'http://localhost:3101' });
  test.setTimeout(120_000);
  test.describe.configure({ mode: 'serial' });

  test('invite, accept, wait in onboarding, get a role by approval, and use the profile', async ({ page, request }, info) => {
    const s = suf(info);
    const errors = watch(page);
    const hr = await tokenOf(request, `hr-${s}`);
    const approver = await tokenOf(request, `approver-${s}`, { enrol: true });
    expect(hr).toBeTruthy();
    const username = `site.engineer.${s}`;
    const created = await (await api(request, '/iam/users', { token: hr, data: { username, displayName: 'Site Engineer', email: `${username}@example.com`, mobile: s === 'd' ? '9000000011' : '9000000012', invite: true } })).json();
    expect(created.data.status).toBe('INVITED');
    const link = created.data.inviteResult.devLink;
    expect(link).toContain('/accept-invite?token=');

    // the link: mismatched and weak passwords are refused, then the password is set
    await page.goto(new URL(link).pathname + new URL(link).search);
    await expect(page.getByRole('heading', { name: 'Welcome to the ERP' })).toBeVisible();
    await expect(page).toHaveTitle(/Accept your invitation/);
    await page.getByLabel('New password').fill(NEW_PW);
    await page.getByLabel('Type it again').fill(`${NEW_PW}x`);
    await page.getByRole('button', { name: 'Set my password' }).click();
    await expect(page.getByText('The two passwords are not the same.')).toBeVisible();
    await page.getByLabel('New password').fill('password123');
    await page.getByLabel('Type it again').fill('password123');
    await page.getByRole('button', { name: 'Set my password' }).click();
    await expect(page.locator('.field-error').first()).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Please correct the highlighted fields');
    await page.getByLabel('New password').fill(NEW_PW);
    await page.getByLabel('Type it again').fill(NEW_PW);
    await page.getByRole('button', { name: 'Set my password' }).click();
    await expect(page.getByTestId('invite-done')).toContainText(username);
    if (info.project.name === 'mobile') await noOverflow(page);
    await page.goto(new URL(link).pathname + new URL(link).search);
    await expect(page.getByTestId('invite-gone')).toContainText(/already used|expired/);

    // restricted onboarding: a welcome page and the profile, nothing else
    await page.goto('/');
    await page.getByLabel('Username, email or mobile').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(NEW_PW);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByTestId('welcome-card')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Welcome, Site Engineer/ })).toBeVisible();
    await expect((await menu(page)).getByRole('link')).toHaveText(['Welcome', 'My Profile', 'Security & MFA', 'My Sessions']);
    await page.goto('/admin/users');
    await expect(page.getByTestId('welcome-card')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
    const token = await page.evaluate(async () => (await (await fetch('/api/v1/iam/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json', 'x-erp-csrf': '1' }, body: '{}' })).json()).data?.accessToken);
    const blocked = await api(request, '/iam/org/projects', { token, method: 'GET' });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error.code).toBe('ONBOARDING_RESTRICTED');

    // a role is requested and approved: the menu appears without signing in again
    const id = created.data.id;
    const asked = await (await api(request, `/iam/users/${id}/role-requests`, { token: hr, data: { roles: ['PM'], reason: 'Joins the Pune team as a site engineer' } })).json();
    expect((await api(request, `/core/change-requests/${asked.data.id}/act`, { token: approver, data: { action: 'approve', comment: 'checked and fine' } })).status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId('welcome-card')).toHaveCount(0);
    await expect((await menu(page)).getByRole('link', { name: 'Projects & Sites' })).toBeVisible();

    // profile: details, language and theme, a photo through the document service
    await (await menu(page)).getByRole('link', { name: 'My Profile' }).click();
    await expect(page.getByRole('heading', { name: 'My Profile', exact: true })).toBeVisible();
    await page.getByLabel('Full name *').fill('Site Engineer Kumar');
    await page.getByLabel('Preferred language').selectOption('hi');
    await page.getByLabel('Text message').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('profile-notice')).toContainText('Your profile was saved');
    // the theme is part of Appearance (part 03.01): shown at once, kept on the server
    const look = page.getByTestId('appearance');
    await look.getByLabel('Dark').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await look.getByRole('radio', { name: /^Compact/ }).check();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    await look.getByRole('button', { name: 'Save appearance' }).click();
    await expect(page.getByTestId('appearance-notice')).toContainText('every device');
    const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#335' } }).png().toBuffer();
    await page.getByLabel('Choose a photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('profile-notice')).toContainText('Your photo was saved', { timeout: 20_000 });
    await expect(page.getByTestId('picture-photo').getByRole('img')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Full name *')).toHaveValue('Site Engineer Kumar');
    await expect(page.getByLabel('Preferred language')).toHaveValue('hi');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    await expect(page.getByTestId('picture-photo').getByRole('img')).toBeVisible();
    if (info.project.name === 'mobile') await noOverflow(page);

    // deactivated by an administrator: the signed-in page is ended at once
    await page.getByRole('button', { name: 'Save', exact: true }).focus();
    const gone = await api(request, `/iam/users/${id}/deactivate`, { token: hr, data: { reason: 'Left the company today', version: (await (await api(request, `/iam/users/${id}`, { token: hr, method: 'GET' })).json()).data.version } });
    expect(gone.status(), await gone.text()).toBe(200);
    await page.reload();
    await expect(page.getByLabel('Username, email or mobile')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
