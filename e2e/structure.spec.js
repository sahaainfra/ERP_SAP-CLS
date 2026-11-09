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

const OUT = 'docs/erp/screenshots/structure';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['plan2', ['PLAN']], ['pm', ['PM']], ['pcm', ['PCMGR']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const mk = (code, name) => { const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, ?, 'BUILDING')").run(c, code, name).lastInsertRowid); db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (?, ?, 'e2e')").run(c, id); return id; };
  const a = mk(`${t.toUpperCase()}-A`, 'Alpha towers'); const b = mk(`${t.toUpperCase()}-B`, 'Beta mall');
  db.close();
  return { u: (k) => `${t}-${k}`, a, b };
}

// Part 10.03: planning starts the WBS of a project from the building template (the whole tree with codes and weights), refuses a weight that breaks 100 %, moves nodes by drag and drop and with "Move to" (Undo takes a move back), edits two nodes at once,
// groups nodes in a work package, keeps a location tree with a floor and a flat, and marks the matrix; the project manager baselines the WBS; after that the structure is locked, a change request (add a node) is raised, approved by planning, the project
// manager and the project controls manager, and shows as version 2 with its diff. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 WBS from a template, edited and baselined; work packages, locations and the matrix; a change after the baseline, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'STM' : 'STD');
  const t = phone ? 'stm' : 'std';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const plan = await open(browser, info, c, 'PLAN', g.u('plan'), `/proj/wbs?projectId=${g.a}`);
  const errors = watch(plan.page);
  await expect(plan.page.getByTestId('wbs-empty')).toBeVisible();
  await shot(plan.page, '01-wbs-empty');
  // the template
  await plan.page.getByTestId('wbs-template-open').click(); await plan.page.getByTestId('wbs-template').selectOption('BUILDING'); await plan.page.getByTestId('wbs-template-apply').click();
  await expect(plan.page.getByTestId('wbs-tree')).toBeVisible();
  await expect(plan.page.locator('[data-testid="wbs-row"][data-code="2.1"]')).toContainText('Excavation and earthwork');
  await expect(plan.page.getByTestId('wbs-problems')).toHaveCount(0);
  if (phone) await noOverflow(plan.page);
  await shot(plan.page, '02-wbs-template');
  // a weight that breaks 100 % is refused with the reason
  await plan.page.getByTestId('wbs-child-2').click(); await plan.page.getByTestId('wbs-f-name').fill('Piling'); await plan.page.getByTestId('wbs-f-weight').fill('40'); await plan.page.getByTestId('wbs-f-save').click();
  await expect(plan.page.getByTestId('wbs-error')).toContainText(/sum to/i);
  await plan.page.getByTestId('wbs-f-weight').fill('0'); await plan.page.getByTestId('wbs-f-save').click();
  await expect(plan.page.locator('[data-testid="wbs-row"][data-code="2.4"]')).toContainText('Piling');
  await plan.page.getByTestId('wbs-normalise').click(); await expect(plan.page.getByTestId('wbs-note')).toBeVisible();
  // a move with "Move to", then Undo
  await plan.page.getByTestId('wbs-moveto-2.4').selectOption({ label: '4 Finishes' });
  await expect(plan.page.getByTestId('wbs-note')).toContainText('2.4');
  await expect(plan.page.getByTestId('wbs-undo')).toBeVisible();
  await plan.page.getByTestId('wbs-undo').click(); await expect(plan.page.getByTestId('wbs-undo')).toHaveCount(0);
  // a drag and drop: node 1 dropped on node 3 becomes its child (the server validates), then taken back
  if (!phone) {
    const dt = await plan.page.evaluateHandle(() => new DataTransfer());
    const src = plan.page.locator('[data-testid="wbs-row"][data-code="1"]'); const tgt = plan.page.locator('[data-testid="wbs-row"][data-code="3"]');
    await src.dispatchEvent('dragstart', { dataTransfer: dt }); await tgt.dispatchEvent('dragover', { dataTransfer: dt }); await tgt.dispatchEvent('drop', { dataTransfer: dt });
    await expect(plan.page.getByTestId('wbs-note')).toContainText('1 was moved');
    await expect(plan.page.locator('[data-testid="wbs-row"][data-code="1"]')).toBeVisible();
    await plan.page.getByTestId('wbs-undo').click(); await expect(plan.page.getByTestId('wbs-undo')).toHaveCount(0);
  }
  // bulk edit of two nodes
  await plan.page.getByLabel('Select 2.1').check(); await plan.page.getByLabel('Select 2.2').check(); await plan.page.getByTestId('wbs-bulk-open').click();
  await plan.page.getByTestId('wbs-bulk-discipline').selectOption('STRUCTURAL'); await plan.page.getByTestId('wbs-bulk-apply').click();
  await expect(plan.page.locator('[data-testid="wbs-row"][data-code="2.2"]')).toContainText('Structural');
  await shot(plan.page, '03-wbs-edited');
  // the work package
  await plan.page.goto(`/proj/work-package?projectId=${g.a}`);
  await plan.page.getByTestId('wp-f-code').fill('WP-FIN'); await plan.page.getByTestId('wp-f-name').fill('Finishes by subcontract'); await plan.page.getByTestId('wp-f-type').selectOption('SUBCONTRACT');
  await plan.page.getByTestId('wp-node-4.1').check(); await plan.page.getByTestId('wp-node-4.2').check(); await plan.page.getByTestId('wp-save').click();
  await expect(plan.page.getByTestId('work-package')).toHaveAttribute('data-status', 'ACTIVE', { timeout: 15_000 });
  await expect(plan.page.getByTestId('wp-note')).toBeVisible();
  await shot(plan.page, '04-work-package');
  await plan.page.goto('/proj/work-packages'); await expect(plan.page.getByText('WP-FIN').first()).toBeVisible(); await shot(plan.page, '05-work-packages');
  // locations: a building, a floor, a flat; the chainage table
  await plan.page.goto(`/proj/locations?projectId=${g.a}`);
  await plan.page.getByTestId('loc-add-root').click(); await plan.page.getByTestId('loc-f-code').fill('TW-A'); await plan.page.getByTestId('loc-f-name').fill('Tower A'); await plan.page.getByTestId('loc-f-save').click();
  await expect(plan.page.locator('[data-testid="loc-row"][data-code="TW-A"]')).toBeVisible();
  await plan.page.getByTestId('loc-child-TW-A').click(); await plan.page.getByTestId('loc-f-code').fill('TW-A-F1'); await plan.page.getByTestId('loc-f-name').fill('First floor'); await plan.page.getByTestId('loc-f-save').click();
  await plan.page.getByTestId('loc-child-TW-A-F1').click(); await plan.page.getByTestId('loc-f-code').fill('TW-A-F1-101'); await plan.page.getByTestId('loc-f-name').fill('Flat 101'); await plan.page.getByTestId('loc-f-save').click();
  await expect(plan.page.locator('[data-testid="loc-row"][data-code="TW-A-F1-101"]')).toBeVisible();
  await plan.page.getByTestId('loc-add-root').click(); await plan.page.getByTestId('loc-f-type').selectOption('CHAINAGE'); await plan.page.getByTestId('loc-f-code').fill('CH-0-5'); await plan.page.getByTestId('loc-f-name').fill('km 0 to 5'); await plan.page.getByTestId('loc-f-from').fill('0'); await plan.page.getByTestId('loc-f-to').fill('5000'); await plan.page.getByTestId('loc-f-save').click();
  await expect(plan.page.locator('[data-testid="loc-row"][data-code="CH-0-5"]')).toBeVisible();
  if (phone) await noOverflow(plan.page);
  await shot(plan.page, '06-locations');
  await plan.page.getByTestId('loc-view-chainage').click(); await expect(plan.page.getByTestId('loc-chainage')).toContainText('0+000'); await shot(plan.page, '07-chainage');
  // the matrix
  await plan.page.goto(`/proj/wbs?projectId=${g.a}`); await plan.page.getByRole('tab', { name: /matrix/i }).click();
  await plan.page.getByTestId('cell-2.1-TW-A-F1-101').click(); await expect(plan.page.getByTestId('cell-2.1-TW-A-F1-101')).toBeChecked();
  await shot(plan.page, '08-matrix');
  // the project manager baselines; the structure is locked
  const pm = await open(browser, info, c, 'PM', g.u('pm'), `/proj/wbs?projectId=${g.a}`);
  const pmErrors = watch(pm.page);
  await expect(pm.page.getByTestId('wbs-add-root')).toHaveCount(0);
  pm.page.on('dialog', (d) => d.accept());
  await pm.page.getByTestId('wbs-baseline').click();
  await expect(pm.page.getByTestId('wbs')).toHaveAttribute('data-baselined', '1', { timeout: 15_000 });
  await expect(pm.page.getByTestId('wbs-state')).toContainText('version 1');
  await plan.page.goto(`/proj/wbs?projectId=${g.a}`);
  await expect(plan.page.getByTestId('wbs-add-root')).toHaveCount(0); await expect(plan.page.getByTestId('wbs-template-open')).toHaveCount(0); await expect(plan.page.getByTestId('wbs-delete-2.1')).toHaveCount(0);
  await shot(plan.page, '09-wbs-baselined');
  // the change request
  await plan.page.getByRole('tab', { name: /changes/i }).click(); await plan.page.getByTestId('change-new').click();
  await plan.page.getByTestId('change-reason').fill('Add a node for the rooftop plant room');
  await plan.page.getByTestId('change-parent-0').selectOption({ label: '2 Substructure' }); await plan.page.getByTestId('change-name-0').fill('Pile load test'); await plan.page.getByTestId('change-weight-0').fill('0');
  await plan.page.getByTestId('change-save').click();
  await expect(plan.page.getByTestId('change-item')).toHaveAttribute('data-status', 'DRAFT', { timeout: 15_000 });
  await plan.page.getByTestId('change-item').getByRole('button', { name: /send for approval/i }).click();
  await expect(plan.page.getByTestId('change-item')).toHaveAttribute('data-status', 'SUBMITTED', { timeout: 15_000 });
  await shot(plan.page, '10-change-sent');
  const list = await api(request, c, 'PLAN', g.u('plan'), 'get', `/proj/wbs-changes?projectId=${g.a}`);
  const inst = list[0].workflowInstanceId;
  await decide(request, c, 'PLAN', g.u('plan2'), inst); await decide(request, c, 'PM', g.u('pm'), inst); await decide(request, c, 'PCMGR', g.u('pcm'), inst);
  await plan.page.reload(); await expect(plan.page.getByTestId('wbs-state')).toContainText('version 2');
  await expect(plan.page.locator('[data-testid="wbs-row"]', { hasText: 'Pile load test' })).toBeVisible();
  await plan.page.getByRole('tab', { name: /versions/i }).click(); await plan.page.getByRole('button', { name: /^Version 2$/ }).click();
  await expect(plan.page.getByTestId('version-detail')).toContainText('Pile load test');
  if (phone) await noOverflow(plan.page);
  await shot(plan.page, '11-versions');
  // an engineer reads; a business developer sees the no-permission state
  const se = await open(browser, info, c, 'SE', g.u('se'), `/proj/wbs?projectId=${g.a}`);
  await expect(se.page.getByTestId('wbs-tree')).toBeVisible(); await expect(se.page.getByTestId('wbs-baseline')).toHaveCount(0);
  const bd = await open(browser, info, c, 'BD', g.u('se'), `/proj/wbs?projectId=${g.a}`);
  await expect(bd.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  expect([...errors, ...pmErrors]).toEqual([]);
});
