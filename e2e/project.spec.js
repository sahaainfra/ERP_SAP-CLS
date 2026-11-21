import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100).
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
  return id;
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

const OUT = 'docs/erp/screenshots/project';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked against the contract' });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['pcm', ['PCMGR']], ['pd', ['PD']], ['pm', ['PM']], ['pm2', ['PM']], ['dir', ['DIR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const partner = (code, name, role) => { const id = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 'e2e', 'e2e')").run(c, code, name, name.toLowerCase()).lastInsertRowid); db.prepare('INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, ?)').run(c, id, role); return id; };
  partner(`${t.toUpperCase()}C1`, 'National Highways Authority', 'CLIENT'); partner(`${t.toUpperCase()}E1`, 'Mott Engineers', 'CONSULTANT');
  db.close();
  return { u: (k) => `${t}-${k}` };
}
const pick = async (page, id, text, name) => { await page.locator(`#${id}`).click(); await page.locator(`#${id}`).fill(text); await page.getByRole('option', { name }).first().click(); };

// Part 10.01: the project controls manager sets a project up with the wizard (basics with the client and the consultant from the partner master, the contract summary, two sites with circle geofences, the team, the numbering series and
// document folders from templates, a milestone, the review with the activation checklist) and sends it for activation; the project director and the director approve; the project manager moves it to execution with the checklist (the budget and
// the baseline are only warnings until those parts are live), keeps its milestones and asks for a suspension, which the chain approves; the portfolio lists it with its state and health. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 a project set up with the wizard, activated with approval, and moved through its lifecycle with checklists, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const t = phone ? 'prjlm' : 'prjld';
  const c = await company(request, t.toUpperCase());
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const code = phone ? 'NH48-M' : 'NH48-D';
  const pcm = await open(browser, info, c, 'PCMGR', g.u('pcm'), '/proj/wizard');
  const errors = watch(pcm.page);
  await expect(pcm.page.getByTestId('wizard')).toBeVisible();
  // 1 basics
  await expect(pcm.page.getByTestId('wiz-next')).toBeDisabled();
  await pcm.page.getByTestId('wz-code').fill(code); await pcm.page.getByTestId('wz-name').fill('Four-laning of NH-48, package 3'); await pcm.page.getByTestId('wz-type').selectOption('ROAD'); await pcm.page.getByTestId('wz-sector').selectOption('ROADS'); await pcm.page.getByTestId('wz-location').fill('Pune');
  await pick(pcm.page, 'wz-client', 'National', /National Highways/); await pick(pcm.page, 'wz-consultant', 'Mott', /Mott Engineers/);
  if (phone) await noOverflow(pcm.page);
  await shot(pcm.page, '01-wizard-basics');
  await pcm.page.getByTestId('wiz-next').click();
  // 2 contract
  await expect(pcm.page.getByTestId('wiz-next')).toBeDisabled();
  await pcm.page.getByTestId('wz-cno').fill('NHAI/2027/118'); await pcm.page.getByTestId('wz-cvalue').fill('972000000'); await pcm.page.getByTestId('wz-start').fill('2026-12-01'); await pcm.page.getByTestId('wz-end').fill('2028-11-30'); await pcm.page.getByTestId('wz-dlp').fill('24'); await pcm.page.getByTestId('wz-ld').fill('0.05 % per day up to 10 % of the contract value');
  await pcm.page.getByTestId('wiz-next').click();
  // 3 sites with circle geofences
  await pcm.page.getByTestId('wz-site-code-0').fill('S1'); await pcm.page.getByTestId('wz-site-name-0').fill('Pune main camp'); await pcm.page.getByTestId('wz-site-lat-0').fill('18.52'); await pcm.page.getByTestId('wz-site-lng-0').fill('73.85'); await pcm.page.getByTestId('wz-site-radius-0').fill('400');
  await pcm.page.getByTestId('wz-site-add').click();
  await pcm.page.getByTestId('wz-site-code-1').fill('S2'); await pcm.page.getByTestId('wz-site-name-1').fill('Batching plant'); await pcm.page.getByTestId('wz-site-geo-1').selectOption('CIRCLE'); await pcm.page.getByTestId('wz-site-lat-1').fill('18.55'); await pcm.page.getByTestId('wz-site-lng-1').fill('73.9'); await pcm.page.getByTestId('wz-site-radius-1').fill('250');
  if (phone) await noOverflow(pcm.page);
  await shot(pcm.page, '02-wizard-sites');
  await pcm.page.getByTestId('wiz-next').click();
  // 4 team
  await pick(pcm.page, 'wz-pm', `pm ${t}`, new RegExp(`pm ${t}`)); await pick(pcm.page, 'wz-director', `pd ${t}`, new RegExp(`pd ${t}`));
  await pcm.page.getByTestId('wiz-next').click();
  // 5 numbering and folders (the defaults)
  await expect(pcm.page.getByTestId('wz-num-DMS')).toBeChecked(); await expect(pcm.page.getByTestId('wz-folders')).toHaveValue('PROJECT_STANDARD');
  await pcm.page.getByTestId('wiz-next').click();
  // 6 settings and a milestone
  await pcm.page.getByTestId('wz-ms-add').click(); await pcm.page.getByTestId('wz-ms-code-0').fill('M1'); await pcm.page.getByTestId('wz-ms-name-0').fill('Mobilisation complete'); await pcm.page.getByTestId('wz-ms-date-0').fill('2027-01-31'); await pcm.page.getByTestId('wz-ms-contractual-0').check();
  await pcm.page.getByTestId('wiz-next').click();
  // 7 review: the button waits for the checklist
  await expect(pcm.page.getByTestId('wiz-send')).toBeDisabled();
  for (let i = 0; i < 4; i += 1) await pcm.page.getByTestId(`wz-tick-${i}`).check();
  if (phone) await noOverflow(pcm.page);
  await shot(pcm.page, '03-wizard-review');
  await pcm.page.getByTestId('wiz-send').click();
  await expect(pcm.page.getByTestId('project')).toHaveAttribute('data-status', 'SUBMITTED');
  await expect(pcm.page.getByTestId('project')).toHaveAttribute('data-state', 'SETUP');
  const id = Number(new URL(pcm.page.url()).searchParams.get('id'));
  await expect(pcm.page.getByTestId('proj-value')).toContainText('97,20,00,000.00');
  await pcm.page.getByTestId('tab-sites').click(); await expect(pcm.page.getByTestId('site-S1')).toBeVisible(); await expect(pcm.page.getByTestId('site-S2')).toContainText('250');
  await pcm.page.getByTestId('tab-milestones').click(); await expect(pcm.page.getByTestId('ms-M1')).toBeVisible();
  if (phone) await noOverflow(pcm.page);
  await shot(pcm.page, '04-project-in-approval');
  // the project director, then the director approve the activation
  const x = await api(request, c, 'PCMGR', g.u('pcm'), 'get', `/proj/projects/${id}`);
  await decide(request, c, 'PD', g.u('pd'), x.workflowInstanceId); await decide(request, c, 'DIR', g.u('dir'), x.workflowInstanceId);
  await pcm.page.reload(); await expect(pcm.page.getByTestId('project')).toHaveAttribute('data-state', 'MOBILISATION');

  // FR-02 the project manager moves it to execution with the checklist; the budget and the baseline are warnings
  const pm = await open(browser, info, c, 'PM', g.u('pm'), `/proj/project?id=${id}`);
  const pmErrors = watch(pm.page);
  await pm.page.getByTestId('proj-move-EXECUTION').click();
  await expect(pm.page.getByTestId('ready-BUDGET')).toContainText('12.01'); await expect(pm.page.getByTestId('ready-BASELINE')).toContainText('13.03');
  await expect(pm.page.getByTestId('move-go')).toBeDisabled();
  for (let i = 0; i < 4; i += 1) await pm.page.getByTestId(`chk-${i}`).check();
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '05-transition-checklist');
  await pm.page.getByTestId('move-go').click();
  await expect(pm.page.getByTestId('project')).toHaveAttribute('data-state', 'EXECUTION');
  // FR-04 a milestone is achieved
  await pm.page.getByTestId('tab-milestones').click(); await pm.page.getByTestId('ms-achieve-M1').click(); await expect(pm.page.getByTestId('ms-status-M1')).toContainText('Achieved');
  await pm.page.getByTestId('ms-code').fill('M2'); await pm.page.getByTestId('ms-name').fill('Earthwork 50 %'); await pm.page.getByTestId('ms-save').click(); await expect(pm.page.getByTestId('ms-M2')).toBeVisible();
  // a suspension goes through the chain: another project manager, the project director, the director
  await pm.page.getByTestId('proj-move-SUSPENDED').click();
  for (let i = 0; i < 4; i += 1) await pm.page.getByTestId(`chk-${i}`).check();
  await pm.page.getByTestId('move-reason').fill('Client has not handed over the land at Km 20');
  await pm.page.getByTestId('move-go').click();
  await expect(pm.page.getByTestId('proj-open')).toContainText('Suspended');
  const y = await api(request, c, 'PM', g.u('pm'), 'get', `/proj/projects/${id}`);
  await decide(request, c, 'PM', g.u('pm2'), y.openRequest.workflowInstanceId); await decide(request, c, 'PD', g.u('pd'), y.openRequest.workflowInstanceId); await decide(request, c, 'DIR', g.u('dir'), y.openRequest.workflowInstanceId);
  await pm.page.reload(); await expect(pm.page.getByTestId('project')).toHaveAttribute('data-state', 'SUSPENDED');
  await pm.page.getByTestId('tab-lifecycle').click(); await expect(pm.page.getByTestId('proj-lifecycle')).toContainText('Execution → Suspended');
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '06-lifecycle-history');

  // FR-06 the portfolio
  await pcm.page.goto('/proj/projects');
  await expect(pcm.page.getByText(code).first()).toBeVisible();
  if (phone) await noOverflow(pcm.page);
  await shot(pcm.page, '07-portfolio');
  expect(errors).toEqual([]); expect(pmErrors).toEqual([]);
});
