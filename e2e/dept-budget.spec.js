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

const OUT = 'docs/erp/screenshots/dept-budget';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['prep', ['HRMGR']], ['head', ['HRMGR']], ['cfo', ['CFO']], ['dir', ['DIR']], ['acc', ['ACCMGR']], ['sys', ['SYSADM']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const uid = Number(db.prepare('SELECT id FROM iam_users WHERE username = ?').get(`${t}-head`).id);
  const dept = Number(db.prepare("INSERT INTO org_departments (company_id, kind, code, name, created_by, source_type) VALUES (?, 'DEPARTMENT', ?, 'Human resources', 'e2e', 'e2e')").run(c, `HR-${t}`).lastInsertRowid);
  db.prepare("INSERT INTO org_assignments (company_id, entity_type, entity_id, role, user_id, effective_from, created_by, source_type) VALUES (?, 'DEPARTMENT', ?, 'HEAD', ?, '2026-01-01', 'e2e', 'e2e')").run(c, dept, uid);
  const cc = Number(db.prepare("INSERT INTO org_cost_centres (company_id, code, name, type, linked_type, linked_id, created_by, source_type) VALUES (?, ?, 'HR cost centre', 'COST', 'DEPARTMENT', ?, 'e2e', 'e2e')").run(c, `CC-${t.toUpperCase()}`, dept).lastInsertRowid);
  const proj = (code, name, cv) => { const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, code, name).lastInsertRowid); db.prepare("INSERT INTO proj_projects (company_id, project_id, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (?, ?, 'EXECUTION', 'x', ?, '2026-04-01', '2027-03-31', 'e2e')").run(c, id, cv); return id; };
  const p1 = proj(`${t.toUpperCase()}-A`, 'Alpha towers', 700_000_000); const p2 = proj(`${t.toUpperCase()}-B`, 'Beta bridge', 300_000_000);
  db.close();
  return { u: (k) => `${t}-${k}`, cc, p1, p2 };
}
async function approve(request, c, roles, user, instanceId, action = 'approve') {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task of instance ${instanceId}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
}

// Part 12.04: a department head prepares the budget of a cost centre in the Workbench (accounts by month, a yearly amount spread by the server), sends it, and the department head, the CFO and the director approve; the approved budget is locked; a new version is
// compared with it; ledger actuals reach the report against the budget with drill-down; an overhead rule is drafted by the accounts manager, put in force by the CFO and run: the shares add up to the pool exactly. A person without the right sees the no-permission state.
test('AC-01 department budget prepared, approved by the chain, compared with a new version, set against actual, and the overhead allocated, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = info.project.name === 'mobile' ? 'dbm' : 'dbd';
  const c = await company(request, t.toUpperCase());
  const s = seed(c, t); const prep = s.u('prep'); const head = s.u('head'); const cfo = s.u('cfo'); const dir = s.u('dir'); const acc = s.u('acc'); const sys = s.u('sys');
  const o = await api(request, c, 'HRMGR', prep, 'get', '/bud/dept-options'); const fy = o.fys[0]; const accounts = o.accounts.slice(0, 3);
  const r = await open(browser, info, c, 'HRMGR', prep, '/bud/dept-budgets');
  const errors = watch(r.page);
  await expect(r.page.getByTestId('dp-budgets')).toBeVisible();
  await expect(r.page.getByText('No department budgets yet')).toBeVisible();
  await r.page.getByTestId('dp-new').click();
  await expect(r.page.getByRole('heading', { name: 'New department budget', level: 1 })).toBeVisible();
  await r.page.getByTestId('dp-fy').selectOption(String(fy.id));
  await r.page.getByTestId('dp-cc').selectOption(String(s.cc));
  await r.page.getByTestId('dp-account').first().selectOption(String(accounts[0].id));
  await r.page.getByTestId('dp-spread-open').first().click();
  await r.page.getByTestId('dp-spread-total').fill('120000');
  await r.page.getByTestId('dp-spread-apply').click();
  await expect(r.page.getByTestId('dp-row-total').first()).toHaveText('1,20,000.00');
  await r.page.getByTestId('dp-row-add').click();
  await r.page.getByTestId('dp-account').nth(1).selectOption(String(accounts[1].id));
  for (let m = 0; m < 12; m += 1) await r.page.getByTestId('dp-row').nth(1).getByTestId('dp-cell').nth(m).fill('5000');
  await expect(r.page.getByTestId('dp-grid-total')).toHaveText('1,80,000.00');
  await shot(r.page, 'workbench-new', info); await noOverflow(r.page);
  await r.page.getByTestId('dp-save').click();
  await expect(r.page.getByTestId('dept-budget')).toHaveAttribute('data-status', 'DRAFT');
  await expect(r.page.getByTestId('dp-total')).toHaveText('₹ 1,80,000.00');
  const id = Number(new URL(r.page.url()).searchParams.get('id'));
  await r.page.getByTestId('dp-submit').click();
  await expect(r.page.getByTestId('dept-budget')).toHaveAttribute('data-status', 'SUBMITTED');
  await expect(r.page.getByTestId('dp-edit')).toHaveCount(0);
  const b = await api(request, c, 'HRMGR', prep, 'get', `/bud/dept-budgets/${id}`);
  await approve(request, c, 'HRMGR', head, b.workflowInstanceId); await approve(request, c, 'CFO', cfo, b.workflowInstanceId); await approve(request, c, 'DIR', dir, b.workflowInstanceId);
  await r.page.reload();
  await expect(r.page.getByTestId('dept-budget')).toHaveAttribute('data-status', 'APPROVED');
  await r.page.getByRole('tab', { name: 'Lines' }).click();
  await expect(r.page.getByTestId('dp-lines-total')).toHaveText('1,80,000.00');
  await r.page.getByRole('tab', { name: 'Approvals' }).click();
  await expect(r.page.getByTestId('dp-history')).toContainText('DEPT_HEAD');
  await shot(r.page, 'budget-approved', info); await noOverflow(r.page);
  // a new version, compared with the one in force
  r.page.on('dialog', (d) => d.accept('Rent goes up from July'));
  await r.page.getByTestId('dp-amend').click();
  await expect(r.page.getByTestId('dept-budget')).toHaveAttribute('data-version', '2');
  await r.page.getByTestId('dp-edit').click();
  await r.page.getByTestId('dp-row').nth(1).getByTestId('dp-cell').nth(8).fill('9000');
  await r.page.getByTestId('dp-save').click();
  await r.page.getByRole('tab', { name: 'Compare' }).click();
  await expect(r.page.getByTestId('dp-cmp-delta')).toContainText('4,000.00');
  await expect(r.page.locator('[data-testid="dp-cmp-row"][data-changed="1"]')).toHaveCount(1);
  await shot(r.page, 'compare', info); await noOverflow(r.page);
  // the ledger (part 23) posts what the department spent
  await api(request, c, 'SYSADM', sys, 'post', '/bud/dept-actuals', { action: 'POST', sourceType: 'fin_journal', sourceId: 'JV-1', docRef: 'JV/2026/001', date: '2026-04-30', lines: [{ lineId: '1', costCentreId: s.cc, accountId: accounts[0].id, amount: 12000, narration: 'April salaries' }, { lineId: '2', costCentreId: s.cc, accountId: accounts[1].id, amount: 6500 }] });
  await r.page.goto(`/bud/dept-report?fyId=${fy.id}`);
  await expect(r.page.getByRole('heading', { name: 'Department Budget vs Actual', level: 1 })).toBeVisible();
  const row = r.page.getByTestId('dr-row').first();
  await expect(row).toContainText('1,80,000.00'); await expect(row).toContainText('18,500.00'); await expect(row).toContainText('1,61,500.00');
  await expect(r.page.getByTestId('dr-notlive')).toHaveCount(0);
  await row.getByTestId('dr-drill').click();
  await expect(r.page.getByTestId('dr-actual').first()).toContainText('JV/2026/001');
  await r.page.getByTestId('dr-by').selectOption('month');
  await expect(r.page.getByTestId('dr-row')).toHaveCount(12);
  await shot(r.page, 'report', info); await noOverflow(r.page);
  // the overhead: the accounts manager drafts a rule, the CFO puts it in force, the accounts manager runs it
  const a = await open(browser, info, c, 'ACCMGR', acc, '/bud/alloc');
  const aerrors = watch(a.page);
  await expect(a.page.getByRole('heading', { name: 'Overhead Allocation Rules', level: 1 })).toBeVisible();
  await expect(a.page.getByTestId('al-empty')).toBeVisible();
  await a.page.getByTestId('al-name').fill('Head office by contract value');
  await a.page.getByTestId('al-cc').first().check();
  await a.page.getByTestId('al-reason').fill('Share head-office cost by contract value');
  await a.page.getByTestId('al-save').click();
  await expect(a.page.getByTestId('al-note')).toBeVisible();
  await expect(a.page.locator('[data-testid="al-rule"][data-status="DRAFT"]')).toHaveCount(1);
  await expect(a.page.getByTestId('al-activate')).toHaveCount(0);
  const rule = (await api(request, c, 'ACCMGR', acc, 'get', '/bud/alloc-rules')).rows[0];
  const k = await open(browser, info, c, 'CFO', cfo, '/bud/alloc');
  await k.page.getByTestId('al-activate').click();
  await expect(k.page.locator('[data-testid="al-rule"][data-status="ACTIVE"]')).toHaveCount(1);
  await a.page.reload();
  await a.page.getByTestId('al-run-rule').selectOption(String(rule.id));
  await a.page.getByTestId('al-run-to').selectOption('3');
  await a.page.getByTestId('al-preview').click();
  await expect(a.page.getByTestId('al-balanced')).toContainText('exactly');
  await expect(a.page.getByTestId('al-line')).toHaveCount(2);
  await expect(a.page.getByTestId('al-allocated')).toHaveText('45,000.00');
  await expect(a.page.getByTestId('al-line').first()).toContainText('31,500.00');
  await shot(a.page, 'allocation-preview', info); await noOverflow(a.page);
  await a.page.getByTestId('al-post').click();
  await expect(a.page.locator('[data-testid="al-run"][data-status="POSTED"]')).toHaveCount(1);
  await shot(a.page, 'allocation-posted', info);
  expect(errors, errors.join('\n')).toEqual([]); expect(aerrors, aerrors.join('\n')).toEqual([]);
  const n = await open(browser, info, c, 'SE', s.u('se'), '/bud/dept-budgets');
  await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  await shot(n.page, 'no-permission', info);
});
