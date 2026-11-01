// Takes sample screenshots of the pages built so far. Needs a development-header server (default http://localhost:3200) and the
// sign-in server (default http://localhost:3000, scripts/e2e_iam_server.mjs), both on fresh databases and the built client.
// Usage: node scripts/screenshots.mjs [outDir]
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
// the refusals are part of the story (a blocked conflict is recorded), so they are expected here
const attempt = (...args) => call(...args).catch((e) => console.log('refused as expected:', String(e.message).slice(0, 160)));
const decide = async (roles, user, type) => {
  const list = await call('GET', `/core/change-requests?filter[type]=${type}`, roles, null, user);
  for (const r of list.filter((x) => x.status === 'SUBMITTED')) await attempt('POST', `/core/change-requests/${r.id}/act`, roles, { action: 'approve', comment: 'checked and fine' }, user);
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
const bridge = await call('POST', '/iam/org/projects', 'PM', { code: 'MTHB', name: 'Mithi river bridge', type: 'BRIDGE' }, 'pooja');
await call('PATCH', `/iam/org/projects/${bridge.id}`, 'PM', { name: 'Mithi river bridge, approach spans', reason: 'Scope covers the approach spans as well', version: bridge.version }, 'pooja').catch(() => {});
// everyone is invited; all but the first two accept (set a password), so they are onboarding until a role is approved
const people = [['Anil Verma', 'anil.verma@example.com', '9876543210', false], ['Bela Shah', 'bela.shah@example.com', '9123456780', false], ['Chandra Rao', 'chandra.rao@example.com', '9811111111', true], ['Dev Patel', 'dev.patel@example.com', '9822222222', true], ['Esha Nair', 'esha.nair@example.com', '9833333333', true], ['Ravi Menon', 'ravi.menon@example.com', '9844444441', true], ['Farah Khan', 'farah.khan@example.com', '9844444442', true], ['Meera Iyer', 'meera.iyer@example.com', '9844444443', true]];
const users = [];
for (const [displayName, email, mobile, accepts] of people) {
  const u = await call('POST', '/iam/users', 'HRMGR', { displayName, email, mobile, invite: true, departmentId: ops.id }, 'hema');
  users.push(u);
  if (!accepts) continue;
  const link = new URL(u.inviteResult.devLink, DEV);
  const token = link.searchParams.get('token') ?? link.pathname.split('/').pop();
  const res = await fetch(`${DEV}/api/v1/iam/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', headers: H('EMP', 'invitee'), body: JSON.stringify({ password: `Rebar-Mesh-${mobile}-Pour` }) }); // secret-scan:allow test passwords
  if (!res.ok) throw new Error(`accept ${displayName} ${res.status} ${await res.text()}`);
}
await call('POST', `/iam/users/${users[2].id}/role-requests`, 'HRMGR', { roles: ['PM'], reason: 'Joins the NH-48 site team' }, 'hema');
await call('POST', `/iam/users/${users[3].id}/role-requests`, 'HRMGR', { roles: ['SE'], reason: 'Site engineer at the Km 12 camp' }, 'hema');
await call('POST', `/iam/users/${users[4].id}/role-requests`, 'HRMGR', { roles: ['CFO'], reason: 'Chief financial officer from 1 October' }, 'hema');
await call('POST', `/iam/users/${users[5].id}/role-requests`, 'HRMGR', { roles: ['AUD'], reason: 'Internal auditor for the western region' }, 'hema');
await call('POST', `/iam/users/${users[6].id}/role-requests`, 'HRMGR', { roles: ['SACC'], reason: 'Site accountant at the Km 12 camp' }, 'hema');
await call('POST', `/iam/users/${users[7].id}/role-requests`, 'HRMGR', { roles: ['DIR'], reason: 'Director, western region projects' }, 'hema');
await decide('SYSADM', 'sysadmin', 'user_role_assignment');
await decide('DIR', 'director', 'user_role_assignment');

// access by assignment: a role for one project, and the conflicts the SoD rules stop
const roles = await call('GET', '/iam/roles?pageSize=100', 'SYSADM', null, 'sysadmin');
const roleId = (code) => roles.find((r) => r.code === code)?.id;
await attempt('POST', '/iam/assignments', 'SYSADM', { userId: users[3].id, roleId: roleId('PM'), scopeType: 'PROJECT', scopeIds: [project.id], reason: 'Second project manager on NH-48 for the monsoon works' }, 'kiran');
await decide('ITADM', 'it.admin', 'iam_assignment');
await decide('DIR', 'director', 'iam_assignment');
await attempt('POST', '/iam/assignments', 'SYSADM', { userId: users[6].id, roleId: roleId('ACCMGR'), scopeType: 'COMPANY', scopeIds: [], reason: 'Covering the quarter close' }, 'kiran.both');
const mine = (await call('GET', '/core/change-requests?filter[type]=iam_assignment', 'SYSADM,ITADM', null, 'kiran.both')).filter((r) => r.status === 'SUBMITTED');
for (const r of mine) await attempt('POST', `/core/change-requests/${r.id}/act`, 'SYSADM,ITADM', { action: 'approve', comment: 'approving my own request' }, 'kiran.both');
await attempt('POST', '/iam/assignments', 'SYSADM', { userId: users[4].id, roleId: roleId('SYSADM'), scopeType: 'COMPANY', scopeIds: [], reason: 'Needs to maintain users as well' }, 'kiran');
await attempt('POST', '/iam/sod-violations/scan', 'AUD', null, 'ravi');
// an access review campaign; the director reviews what the others hold (nobody reviews their own access)
const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
await attempt('POST', '/iam/access-reviews', 'AUD', { name: 'Quarterly access review, Q3', scope: 'ALL', dueDate: due }, 'ravi');
// an access refused (it shows on the security events) and a feature flag read
await fetch(`${DEV}/api/v1/core/audit`, { headers: H('EMP', 'site.helper') });
await fetch(`${DEV}/api/v1/iam/sod-violations`, { headers: H('PM', 'pooja') });
const auditor = users[5];
console.log('auditor', auditor.username);

const browser = await chromium.launch({ channel: 'chrome' });
/** @param {string} name @param {string} url @param {{ roles?: string, user?: string, width?: number, height?: number, action?: (page: any) => Promise<any>, full?: boolean, base?: string, theme?: string, density?: string, mainOnly?: boolean }} [opts] */
const shoot = async (name, url, { roles = 'HRMGR', user = 'hema', width = 1280, height = 800, action = undefined, full = false, base = DEV, theme = 'light', density = 'comfortable', mainOnly = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, baseURL: base });
  const page = await ctx.newPage();
  await page.addInitScript((look) => localStorage.setItem('erp.appearance', JSON.stringify(look)), { theme, density, language: 'en' });
  if (base === DEV) await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: '1' });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  if (action) await action(page);
  await page.waitForTimeout(500);
  const box = mainOnly ? await page.locator('main#main').boundingBox() : null;
  if (box) await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 1000) } });
  else await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log('saved', `${out}/${name}.png`);
  await ctx.close();
};
// one role the development identity bar can show; the auditor role is not in its list, so auditor pages are taken without the shell
const ADMIN = { roles: 'SYSADM', user: 'sysadmin' };
const IT = { roles: 'ITADM', user: 'it.admin' };
const AUD = { roles: 'AUD', user: auditor.username, mainOnly: true };
const centre = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
const top = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: 'start' }));

await shoot('01-users-list', '/admin/users');
await shoot('02-user-page', '/admin/users', { action: async (p) => { await p.getByRole('link', { name: 'Chandra Rao' }).click(); await p.getByRole('tab', { name: 'Assignments' }).click(); } });
await shoot('03-invite-user', '/admin/users', { action: async (p) => { await p.getByRole('button', { name: 'Invite user' }).first().click(); await p.locator('dialog[open] input[name=displayName]').fill('Gopal Iyer'); await p.locator('dialog[open] input[name=email]').fill('anil.verma@example.com'); await p.locator('dialog[open] input[name=mobile]').click(); } });
await shoot('04-import-users', '/admin/users', { action: async (p) => { await p.getByRole('button', { name: 'Import users' }).click(); await p.getByTestId('import-text').fill('name,email,mobile\nGopal Iyer,gopal@example.com,9844444444\nAnil Again,anil.verma@example.com,9855555555\nHema Bad,hema@example.com,123'); await p.getByRole('button', { name: 'Check the file' }).click(); await p.getByTestId('import-summary').waitFor(); } });
await shoot('05-organisation-departments', '/admin/organisation', { action: (p) => p.getByRole('tab', { name: 'Departments' }).click() });
await shoot('06-projects-and-sites', '/admin/projects', { roles: 'PM', user: 'pooja' });
await shoot('07-organisation-chart', '/admin/org-chart');
await shoot('08-users-list-mobile', '/admin/users', { width: 360, height: 740 });
await shoot('13-admin-operations-health', '/admin/operations/health', IT);
await shoot('14-admin-data-health', '/admin/data-health', { ...IT, action: async (p) => { await p.getByRole('button', { name: 'Run checks now' }).first().click(); await p.getByRole('button', { name: 'Run checks now' }).first().waitFor(); await p.waitForLoadState('networkidle'); } });
await shoot('15-admin-events-and-jobs', '/admin/operations', IT);
await shoot('16-admin-about', '/admin/about', IT);
await shoot('17-roles', '/admin/roles', ADMIN);
await shoot('18-role-permission-matrix', '/admin/roles', { ...ADMIN, action: async (p) => { await p.getByRole('searchbox', { name: 'Search roles' }).fill('PM'); await p.getByRole('link', { name: 'PM', exact: true }).click(); await centre(p.getByTestId('cell-org.view')); } });
await shoot('19-assignments', '/admin/assignments', ADMIN);
await shoot('20-effective-permissions', `/admin/effective-access?userId=${users[3].id}`, ADMIN);
await shoot('21-sod-rules', '/admin/sod/rules', { ...ADMIN, action: async (p) => { await p.getByRole('button', { name: 'Open rule SOD-02' }).click(); await centre(p.getByTestId('rule-detail')); } });
await shoot('22-sod-violations', '/admin/sod/violations', { ...ADMIN, action: async (p) => { await p.locator('select[aria-label="Status"]').selectOption(''); await p.waitForLoadState('networkidle'); } });
await shoot('23-access-reviews', '/admin/access-reviews', { ...ADMIN, action: async (p) => { await p.getByRole('button', { name: /Open campaign AR-/ }).click(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300); await p.mouse.wheel(0, 380); } });
await shoot('24-audit-explorer', '/admin/audit', { ...AUD, action: async (p) => { await p.getByRole('button', { name: 'Verify now' }).click(); await p.getByTestId('audit-notice').waitFor(); } });
await shoot('25-audit-record-timeline', '/admin/audit', { ...AUD, action: async (p) => { await p.getByLabel('Person', { exact: true }).fill('pooja'); await p.getByRole('button', { name: /Show the timeline of org_projects/ }).first().click(); await p.getByRole('button', { name: 'Details' }).first().click(); await top(p.getByText(/Timeline of org_projects/)); } });
await shoot('26-security-events', '/admin/security-events', ADMIN);
await shoot('27-route-registry', '/admin/security/routes', ADMIN);
await shoot('28-security-settings', '/admin/security/settings', ADMIN);
await shoot('29-design-system', '/admin/design-system', ADMIN);
await shoot('30-design-system-icons', '/admin/design-system', { ...ADMIN, action: async (p) => { await top(p.getByRole('heading', { name: 'Icons', exact: true })); } });
await shoot('31-users-list-dark', '/admin/users', { theme: 'dark' });
await shoot('32-projects-high-contrast', '/admin/projects', { roles: 'PM', user: 'pooja', theme: 'high-contrast' });
await shoot('33-users-list-compact', '/admin/users', { density: 'compact' });
await shoot('34-security-events-mobile-dark', '/admin/security-events', { ...ADMIN, width: 360, height: 740, theme: 'dark', action: (p) => top(p.getByRole('heading', { name: 'Security Events' })) });
await shoot('09-sign-in', '/', { base: IAM });

// the invitation link, the welcome page, My Profile and elevated access (sign-in server)
/** @param {string} method @param {string} path @param {{ token?: string, data?: any }} [opts] @returns {Promise<any>} */
const api = async (method, path, { token = undefined, data = undefined } = {}) => {
  const res = await fetch(`${IAM}/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'x-token-delivery': 'body', 'idempotency-key': `s-${Math.random().toString(36).slice(2, 12)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined });
  return (await res.json()).data;
};
const PW = 'Excavator-Test-9-Pw'; // secret-scan:allow the seeded test password of the sign-in server
const hr = (await api('POST', '/iam/auth/login', { data: { username: 'hr-d', password: PW, deviceId: 'device-shots-0001', deviceName: 'Screenshots' } })).accessToken;
const stamp = Date.now().toString(36);
const invited = await api('POST', '/iam/users', { token: hr, data: { username: `site.engineer.${stamp}`, displayName: 'Site Engineer', email: `se.${stamp}@example.com`, invite: true } });
const link = new URL(invited.inviteResult.devLink);
await shoot('10-accept-invitation', link.pathname + link.search, { base: IAM });
const signIn = async (username, password) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: IAM });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' })));
  await page.goto('/');
  await page.getByLabel('Username, email or mobile').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return { ctx, page };
};
const snap = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', `${out}/${name}.png`); };
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: IAM });
  const page = await ctx.newPage();
  await page.goto(link.pathname + link.search);
  await page.getByLabel('New password').fill('Culvert-Pour-47-Slab'); // secret-scan:allow a test password set for the invited person
  await page.getByLabel('Type it again').fill('Culvert-Pour-47-Slab'); // secret-scan:allow
  await page.getByRole('button', { name: 'Set my password' }).click();
  await page.getByTestId('invite-done').waitFor();
  await ctx.close();
}
{
  const { ctx, page } = await signIn(`site.engineer.${stamp}`, 'Culvert-Pour-47-Slab'); // secret-scan:allow
  await page.getByTestId('welcome-card').waitFor();
  await snap(page, '11-welcome-onboarding');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My Profile' }).click();
  await page.getByRole('heading', { name: 'My Profile', exact: true }).waitFor();
  await snap(page, '12-my-profile');
  await ctx.close();
}
{
  // Appearance (a person with a role): dark and compact previewed before saving
  const { ctx, page } = await signIn('appear-d', PW);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My Profile' }).click();
  const look = page.getByTestId('appearance');
  await look.getByRole('heading', { name: 'Appearance' }).waitFor();
  await look.getByLabel('Dark', { exact: true }).check();
  await look.getByRole('radio', { name: /^Compact/ }).check();
  await look.scrollIntoViewIfNeeded();
  await snap(page, '35-appearance-preview');
  await ctx.close();
}
{
  // a project manager asks for the auditor role for two hours; the IT administrator approves
  const { ctx, page } = await signIn('elev-d', PW);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Request Elevated Access' }).click();
  await page.getByRole('heading', { name: 'Request Elevated Access' }).waitFor();
  await page.locator('select[name=roleId]').selectOption({ label: 'AUD - Internal Auditor' });
  await page.locator('input[name=hours]').fill('2');
  await page.locator('textarea[name=reason]').fill('Investigating a duplicate payment query on the NH-48 subcontract');
  await page.getByRole('button', { name: 'Send the request' }).click();
  await page.getByTestId('elevation-notice').waitFor();
  await snap(page, '36-elevation-request');
  await ctx.close();
}
await browser.close();
