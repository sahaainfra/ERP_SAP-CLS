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

const OUT = 'docs/erp/screenshots/risk';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['pm', ['PM']], ['pm2', ['PM']], ['pd', ['PD']], ['se', ['SE']], ['plan', ['PLAN']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Ring road package 2', 'ROAD')").run(c, `${t.toUpperCase()}-R`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (?, ?, 'e2e')").run(c, id);
  db.close();
  return { u: (k) => `${t}-${k}`, id };
}
const pick = async (page, id, text, name) => { await page.locator(`#${id}`).click(); await page.locator(`#${id}`).fill(text); await page.getByRole('option', { name }).first().click(); };
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const risk = (g, over = {}) => ({ projectId: g.id, rtype: 'RISK', title: 'Monsoon delays the foundation concreting', cause: 'Heavy rainfall in July', effect: 'Concreting stops for weeks', category: 'TECHNICAL', ownerUser: g.u('se'), probability: 4, impactCost: 5, impactTime: 3, strategy: 'MITIGATE',
  exposureCost: { min: '2000000', mostLikely: '5000000', max: '9000000' }, exposureDays: { min: 5, mostLikely: 20, max: 40 }, actions: [{ description: 'Order rain covers and a dewatering pump', ownerUser: g.u('plan'), dueDate: day(10) }], triggers: [{ name: 'Rainfall', indicator: 'mm in 24 hours', comparator: 'GTE', threshold: 100, unit: 'mm' }], ...over });

// Part 10.06: the project manager sets the contingency pool and the thresholds; the register has a critical and a medium risk, so the heat map and the EMV totals show them; a site engineer raises a risk with the form (the score, level and EMV come from the
// server); the owner records a reading that passes the threshold of a trigger and the trigger fires; the project manager allocates contingency; the owner asks to close the critical risk and the project manager approves; an issue is logged and resolved;
// the monthly review is prepared, sent and approved by the project manager and then the project director. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 risk dashboard, register, risk page, trigger, contingency, closure, issue log and monthly review, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'RKM' : 'RKD');
  const t = phone ? 'rkm' : 'rkd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const pm = await open(browser, info, c, 'PM', g.u('pm'), `/proj/risk-dashboard?projectId=${g.id}`);
  const errors = watch(pm.page);
  await expect(pm.page.getByTestId('risk-dashboard')).toBeVisible(); await expect(pm.page.getByTestId('rk-top')).toContainText(/no open risks/i);
  // the pool and the thresholds (BR-01)
  await pm.page.getByTestId('rk-cfg-pool').fill('10000000'); await pm.page.getByTestId('rk-cfg-save').click(); await expect(pm.page.getByTestId('rk-note')).toBeVisible();
  const r1 = await api(request, c, 'SE', g.u('se'), 'post', '/proj/risks', risk(g));
  await api(request, c, 'SE', g.u('se'), 'post', '/proj/risks', risk(g, { title: 'Cement price rises', category: 'COMMERCIAL', probability: 2, impactCost: 2, impactTime: 3, strategy: 'ACCEPT', actions: [], triggers: [], exposureCost: { min: '500000', mostLikely: '1000000', max: '1500000' } }));
  await pm.page.reload();
  await expect(pm.page.getByTestId('rk-cell-4-5')).toHaveAttribute('data-count', '1'); await expect(pm.page.getByTestId('rk-cell-2-3')).toHaveAttribute('data-count', '1'); await expect(pm.page.getByTestId('rk-risk-emv')).toContainText('38,00,000.00');
  await expect(pm.page.getByTestId('rk-tile-critical')).toContainText('1'); await expect(pm.page.getByTestId('rk-covered')).toContainText(/exceeds/i);
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '01-dashboard');
  // the register and a new risk raised with the form
  const se = await open(browser, info, c, 'SE', g.u('se'), `/proj/risks?filter[projectId]=${g.id}`); const seErrors = watch(se.page);
  await expect(se.page.getByTestId('risks')).toBeVisible(); await expect(se.page.getByText('Monsoon delays the foundation concreting').first()).toBeVisible();
  if (phone) await noOverflow(se.page);
  await shot(se.page, '02-register');
  await se.page.getByTestId('rk-new').click(); await se.page.getByTestId('rk-f-project').selectOption(String(g.id)); await se.page.getByTestId('rk-f-title').fill('Scaffold collapse on level 3'); await se.page.getByTestId('rk-f-category').selectOption('SAFETY');
  await pick(se.page, 'rk-f-owner', `se ${t}`, new RegExp(`se ${t}`)); await se.page.getByTestId('rk-f-probability').selectOption('3'); await se.page.getByTestId('rk-f-impactSafety').selectOption('4'); await se.page.getByTestId('rk-f-ml').fill('2000000');
  await se.page.getByTestId('rk-f-action').fill('Inspect all scaffolds before each pour'); await se.page.getByTestId('rk-create').click();
  await expect(se.page.getByTestId('risk')).toBeVisible({ timeout: 15_000 }); await expect(se.page.getByTestId('risk')).toHaveAttribute('data-level', 'HIGH'); await expect(se.page.getByTestId('rk-emv')).toContainText('10,00,000.00');
  if (phone) await noOverflow(se.page);
  await shot(se.page, '03-risk');
  // the critical risk: a reading that passes the threshold fires the trigger
  await se.page.goto(`/proj/risk?id=${r1.id}`); await se.page.getByRole('tab', { name: /response/i }).click();
  await se.page.getByTestId('rk-reading-0').fill('120'); await se.page.getByTestId('rk-reading-save-0').click(); await expect(se.page.getByTestId('rk-fired-0')).toBeVisible({ timeout: 15_000 });
  if (phone) await noOverflow(se.page);
  await shot(se.page, '04-trigger-fired');
  // contingency (the project manager)
  await pm.page.goto(`/proj/risk?id=${r1.id}`); await pm.page.getByRole('tab', { name: /contingency/i }).click();
  await pm.page.getByTestId('rk-cont-amount').fill('2000000'); await pm.page.getByTestId('rk-cont-reason').fill('Monsoon reserve for the foundations'); await pm.page.getByTestId('rk-cont-save').click();
  await expect(pm.page.getByTestId('rk-tab-contingency')).toContainText('20,00,000.00', { timeout: 15_000 });
  await shot(pm.page, '05-contingency');
  // BR-02: the owner asks to close; the project manager approves
  await se.page.reload(); await se.page.getByTestId('rk-close').click(); await se.page.getByTestId('rk-close-reason').fill('The foundations are cast and the monsoon exposure has passed'); await se.page.getByTestId('rk-close-send').click();
  await expect(se.page.getByTestId('risk')).toHaveAttribute('data-status', 'CLOSE_REQUESTED', { timeout: 15_000 }); await expect(se.page.getByTestId('rk-closing')).toBeVisible();
  await shot(se.page, '06-closure-waiting');
  const inst = (await api(request, c, 'SE', g.u('se'), 'get', `/proj/risks/${r1.id}`)).workflowInstanceId;
  await decide(request, c, 'PM', g.u('pm'), inst);
  await se.page.reload(); await expect(se.page.getByTestId('risk')).toHaveAttribute('data-status', 'CLOSED'); await expect(se.page.getByTestId('rk-closed')).toBeVisible();
  // the issue log
  await se.page.goto(`/proj/issues?filter[projectId]=${g.id}`); await se.page.getByTestId('iss-new').click(); await se.page.getByTestId('iss-f-project').selectOption(String(g.id)); await se.page.getByTestId('iss-f-title').fill('Tower crane breakdown'); await se.page.getByTestId('iss-f-priority').selectOption('HIGH');
  await pick(se.page, 'iss-f-owner', `se ${t}`, new RegExp(`se ${t}`)); await se.page.getByTestId('iss-create').click();
  await expect(se.page.getByTestId('issue')).toBeVisible({ timeout: 15_000 }); await se.page.getByTestId('iss-resolution-input').fill('The gearbox was replaced and the crane recommissioned'); await se.page.getByTestId('iss-resolve-btn').click();
  await expect(se.page.getByTestId('issue')).toHaveAttribute('data-status', 'RESOLVED', { timeout: 15_000 });
  if (phone) await noOverflow(se.page);
  await shot(se.page, '07-issue');
  await se.page.goto(`/proj/issues?filter[projectId]=${g.id}`); await expect(se.page.getByTestId('issues')).toBeVisible(); await expect(se.page.getByText('Tower crane breakdown').first()).toBeVisible(); await shot(se.page, '08-issue-log');
  // the monthly review: prepared and sent by the project manager, approved by another project manager and then the project director
  await pm.page.goto(`/proj/risk-dashboard?projectId=${g.id}`); await pm.page.getByTestId('rk-review-period').fill('2026-11'); await pm.page.getByTestId('rk-review-new').click(); await expect(pm.page.getByTestId('rk-review-2026-11')).toBeVisible({ timeout: 15_000 });
  await pm.page.getByTestId('rk-review-submit-2026-11').click(); await expect(pm.page.getByTestId('rk-review-2026-11')).toContainText(/waiting/i, { timeout: 15_000 });
  const reviews = await api(request, c, 'PM', g.u('pm'), 'get', `/proj/risk-reviews?projectId=${g.id}`); const rinst = reviews[0].workflowInstanceId;
  await decide(request, c, 'PM', g.u('pm2'), rinst); await decide(request, c, 'PD', g.u('pd'), rinst);
  await pm.page.reload(); await expect(pm.page.getByTestId('rk-review-2026-11')).toContainText(/reviewed/i); if (phone) await noOverflow(pm.page);
  await shot(pm.page, '09-monthly-review');
  expect(errors, 'console errors (project manager)').toEqual([]); expect(seErrors, 'console errors (site engineer)').toEqual([]);
});
