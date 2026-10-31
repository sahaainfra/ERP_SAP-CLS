import { test, expect } from '@playwright/test';
import { counterAt, totpAt } from '../src/server/platform/identity/totp.js';

// A person assigned to one project, signed in for real (port 3101, scripts/e2e_iam_server.mjs): the pages show that project only.
// Runs last, because sign-in is limited to 30 attempts a minute per address and the sign-in specs use most of that.
test.use({ baseURL: 'http://localhost:3101' });
test.describe.configure({ mode: 'serial' });

const PW = 'Excavator-Test-9-Pw';
const suf = (info) => (info.project.name === 'desktop' ? 'd' : 'm');
const api = (request, path, { token, data, method = 'POST' } = {}) =>
  request.fetch(`http://localhost:3101/api/v1${path}`, { method, data, headers: { 'x-token-delivery': 'body', 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) } });

async function tokenOf(request, username, { enrol = false } = {}) {
  const device = { deviceId: `device-${username}-0002`, deviceName: 'E2E' };
  let res = await api(request, '/iam/auth/login', { data: { username, password: PW, ...device } });
  for (let i = 0; i < 14 && res.status() === 429; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    res = await api(request, '/iam/auth/login', { data: { username, password: PW, ...device } });
  }
  const first = await res.json();
  if (!enrol) return first.data.accessToken;
  const begin = await (await api(request, '/iam/auth/mfa/enrol/begin', { data: { challengeToken: first.data.challengeToken } })).json();
  const done = await (await api(request, '/iam/auth/mfa/enrol/confirm', { data: { challengeToken: first.data.challengeToken, code: totpAt(begin.data.secret, counterAt(Date.now())), ...device } })).json();
  return done.data.accessToken;
}

test('a person assigned to one project sees that project only, and the pages say what they may do', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const s = suf(info);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (403|404)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  const pmx = await tokenOf(request, `pmx-${s}`);
  const admin = await tokenOf(request, `scopeadm-${s}`, { enrol: true });
  const checker = await tokenOf(request, `scopeit-${s}`, { enrol: true });
  const director = await tokenOf(request, `dir-${s}`, { enrol: true });
  const mkProject = async (code, name) => (await (await api(request, '/iam/org/projects', { token: pmx, data: { code, name, type: 'ROAD' } })).json()).data;
  const alpha = await mkProject(`ALPHA-${s}`, 'Alpha road');
  const bravo = await mkProject(`BRAVO-${s}`, 'Bravo bridge');
  const users = await (await api(request, `/iam/users?q=scoped-${s}`, { token: admin, method: 'GET' })).json();
  expect(users.data?.length, JSON.stringify(users)).toBeGreaterThan(0);
  const roles = await (await api(request, '/iam/roles?q=PM&pageSize=100', { token: admin, method: 'GET' })).json();
  expect(roles.data?.some((r) => r.code === 'PM'), JSON.stringify(roles).slice(0, 300)).toBe(true);
  const asked = await (await api(request, '/iam/assignments', { token: admin, data: { userId: users.data[0].id, roleId: roles.data.find((r) => r.code === 'PM').id, scopeType: 'PROJECT', scopeIds: [alpha.id], reason: 'Runs the Alpha road project' } })).json();
  expect(asked.data.chain).toEqual(['ITADM', 'DIR']);
  for (const [who, token] of [['checker', checker], ['director', director]]) {
    const res = await api(request, `/core/change-requests/${asked.data.id}/act`, { token, data: { action: 'approve', comment: 'checked and fine' } });
    expect(res.status(), `${who}: ${await res.text()}`).toBe(200);
  }

  // signs in through the screen and sees one project
  await page.goto('/');
  await page.getByLabel('Username, email or mobile').fill(`scoped-${s}`);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Projects & Sites' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Roles' })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Projects & Sites' }).click();
  await expect(page.getByRole('heading', { name: 'Projects & Sites', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `ALPHA-${s}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `BRAVO-${s}` })).toHaveCount(0);
  await expect(page.getByText('1 projects, page 1 of 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);

  // and the API agrees, for the other project by any route
  const token = await page.evaluate(async () => (await (await fetch('/api/v1/iam/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json', 'x-erp-csrf': '1' }, body: '{}' })).json()).data?.accessToken);
  expect((await api(request, `/iam/org/projects/${bravo.id}`, { token, method: 'GET' })).status()).toBe(404);
  expect((await api(request, `/iam/org/projects/${alpha.id}`, { token, method: 'GET' })).status()).toBe(200);
  expect((await api(request, `/iam/org/departments`, { token, method: 'GET' })).status()).toBe(403);
  const access = await (await api(request, '/iam/me/access', { token, method: 'GET' })).json();
  expect(access.data.scopes['org.view'].projects).toEqual([alpha.id]);
  expect(errors).toEqual([]);
});
