// Takes sample screenshots of the pages built so far. Needs a development-header server (default http://localhost:3200) and the
// sign-in server (default http://localhost:3000, scripts/e2e_iam_server.mjs). Usage: node scripts/screenshots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const DEV = process.env.DEV_URL ?? 'http://localhost:3200';
const IAM = process.env.IAM_URL ?? 'http://localhost:3000';
const out = process.argv[2] ?? 'docs/erp/screenshots';
mkdirSync(out, { recursive: true });

const H = (roles, user = 'shots') => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': '1', 'content-type': 'application/json', 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}` });
const call = async (method, path, roles, body, user) => {
  const res = await fetch(`${DEV}/api/v1${path}`, { method, headers: H(roles, user), body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${JSON.stringify(json)}`);
  return json.data;
};
const decide = async (roles, user, type) => {
  const list = await call('GET', `/core/change-requests?filter[type]=${type}`, roles, null, user);
  for (const r of list.filter((x) => x.status === 'SUBMITTED')) await call('POST', `/core/change-requests/${r.id}/act`, roles, { action: 'approve', comment: 'checked and fine' }, user);
};

// ---- sample data (development server) ----
const ops = await call('POST', '/iam/org/departments', 'HRMGR', { code: 'OPS', name: 'Operations', kind: 'DIVISION' });
await call('POST', '/iam/org/departments', 'HRMGR', { code: 'ENG', name: 'Engineering', kind: 'DEPARTMENT', parentId: ops.id });
await call('POST', '/iam/org/departments', 'HRMGR', { code: 'QA', name: 'Quality Assurance', kind: 'DEPARTMENT', parentId: ops.id });
await call('POST', '/iam/org/departments', 'HRMGR', { code: 'FIN', name: 'Finance', kind: 'DIVISION' });
await call('POST', '/iam/org/branches', 'SYSADM', { code: 'WEST', name: 'West region', kind: 'REGION' });
await call('POST', '/iam/org/branches', 'SYSADM', { code: 'MUM', name: 'Mumbai', kind: 'BRANCH', stateCode: '27' });
const project = await call('POST', '/iam/org/projects', 'PM', { code: 'NH48', name: 'NH-48 Widening, Package 2', type: 'ROAD' }, 'pooja');
await call('POST', `/iam/org/projects/${project.id}/activation-requests`, 'PM', { reason: 'Contract signed and mobilised' }, 'pooja');
await decide('PD', 'pradeep', 'org_activation');
await decide('PCMGR', 'pc', 'org_activation');
const site = await call('POST', '/iam/org/sites', 'PM', { code: 'NH48-S1', name: 'Km 12 camp', projectId: project.id }, 'pooja');
await call('PATCH', `/iam/org/sites/${site.id}`, 'PM', { geofenceType: 'CIRCLE', latitude: 19.076, longitude: 72.8777, geofenceRadiusM: 250, version: site.version }, 'pooja');
await call('POST', '/iam/org/cost-centres', 'ACCMGR', { code: 'CC-S1', name: 'Km 12 camp cost', linkedType: 'SITE', linkedId: site.id });
const people = [['Anil Verma', 'anil.verma@example.com', '9876543210', true], ['Bela Shah', 'bela.shah@example.com', '9123456780', true], ['Chandra Rao', 'chandra.rao@example.com', '9811111111', false], ['Dev Patel', 'dev.patel@example.com', '9822222222', false], ['Esha Nair', 'esha.nair@example.com', '9833333333', false]];
const users = [];
for (const [displayName, email, mobile, invite] of people) users.push(await call('POST', '/iam/users', 'HRMGR', { displayName, email, mobile, invite, departmentId: ops.id }, 'hema'));
await call('POST', `/iam/users/${users[2].id}/role-requests`, 'HRMGR', { roles: ['PM'], reason: 'Joins the NH-48 site team' }, 'hema');
await decide('SYSADM', 'sysadmin', 'user_role_assignment');

const browser = await chromium.launch({ channel: 'chrome' });
/** @param {string} name @param {string} url @param {{ roles?: string, user?: string, width?: number, height?: number, action?: (page: any) => Promise<any>, full?: boolean, base?: string }} [opts] */
const shoot = async (name, url, { roles = 'HRMGR', user = 'hema', width = 1280, height = 800, action = undefined, full = false, base = DEV } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, baseURL: base });
  const page = await ctx.newPage();
  if (base === DEV) await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: '1' });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  if (action) await action(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log('saved', `${out}/${name}.png`);
  await ctx.close();
};

await shoot('01-users-list', '/admin/users');
await shoot('02-user-page', '/admin/users', { action: async (p) => { await p.getByRole('link', { name: 'Chandra Rao' }).click(); await p.getByRole('tab', { name: 'Assignments' }).click(); } });
await shoot('03-invite-user', '/admin/users', { action: async (p) => { await p.getByRole('button', { name: 'Invite user' }).first().click(); await p.locator('dialog[open] input[name=displayName]').fill('Farah Khan'); await p.locator('dialog[open] input[name=email]').fill('anil.verma@example.com'); await p.locator('dialog[open] input[name=mobile]').click(); } });
await shoot('04-import-users', '/admin/users', { action: async (p) => { await p.getByRole('button', { name: 'Import users' }).click(); await p.getByTestId('import-text').fill('name,email,mobile\nGopal Iyer,gopal@example.com,9844444444\nAnil Again,anil.verma@example.com,9855555555\nHema Bad,hema@example.com,123'); await p.getByRole('button', { name: 'Check the file' }).click(); await p.getByTestId('import-summary').waitFor(); } });
await shoot('05-organisation-departments', '/admin/organisation', { action: (p) => p.getByRole('tab', { name: 'Departments' }).click() });
await shoot('06-projects-and-sites', '/admin/projects', { roles: 'PM', user: 'pooja' });
await shoot('07-organisation-chart', '/admin/org-chart');
await shoot('08-users-list-mobile', '/admin/users', { width: 360, height: 740 });
await shoot('09-sign-in', '/', { base: IAM });

// the invitation link and the welcome page (sign-in server)
/** @param {string} method @param {string} path @param {{ token?: string, data?: any }} [opts] @returns {Promise<any>} */
const api = async (method, path, { token = undefined, data = undefined } = {}) => {
  const res = await fetch(`${IAM}/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined });
  return (await res.json()).data;
};
const PW = 'Excavator-Test-9-Pw';
const hr = (await api('POST', '/iam/auth/login', { data: { username: 'hr-d', password: PW, deviceId: 'device-shots-0001', deviceName: 'Screenshots' } })).accessToken;
const stamp = Date.now().toString(36);
const invited = await api('POST', '/iam/users', { token: hr, data: { username: `site.engineer.${stamp}`, displayName: 'Site Engineer', email: `se.${stamp}@example.com`, invite: true } });
const link = new URL(invited.inviteResult.devLink);
await shoot('10-accept-invitation', link.pathname + link.search, { base: IAM });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: IAM });
const page = await ctx.newPage();
await page.goto(link.pathname + link.search);
await page.getByLabel('New password').fill('Culvert-Pour-47-Slab');
await page.getByLabel('Type it again').fill('Culvert-Pour-47-Slab');
await page.getByRole('button', { name: 'Set my password' }).click();
await page.getByTestId('invite-done').waitFor();
await page.goto('/');
await page.getByLabel('Username, email or mobile').fill(`site.engineer.${stamp}`);
await page.getByLabel('Password', { exact: true }).fill('Culvert-Pour-47-Slab');
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.getByTestId('welcome-card').waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/11-welcome-onboarding.png` });
console.log('saved', `${out}/11-welcome-onboarding.png`);
await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My Profile' }).click();
await page.getByRole('heading', { name: 'My Profile', exact: true }).waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/12-my-profile.png` });
console.log('saved', `${out}/12-my-profile.png`);
await ctx.close();
await browser.close();
