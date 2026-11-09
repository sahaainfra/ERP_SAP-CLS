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

const OUT = 'docs/erp/screenshots/budget';
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['qs', ['QS']], ['pcm', ['PCMGR']], ['pm', ['PM']], ['pd', ['PD']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Alpha towers', 'BUILDING')").run(c, `${t.toUpperCase()}-A`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (?, ?, 'EXECUTION', ?, 1000000000, '2026-01-01', '2026-12-31', 'e2e')").run(c, pid, `${t}-pm`);
  const wbs = (code, name, parent, ca) => Number(db.prepare('INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, is_control_account, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c, pid, parent, code, name, parent ? 2 : 1, ca, 'e2e').lastInsertRowid);
  const w1 = wbs('W1', 'Superstructure', null, 1); const w11 = wbs('W1.1', 'Columns', w1, 0); const w2 = wbs('W2', 'Foundations', null, 1);
  db.prepare("INSERT INTO proj_work_packages (company_id, project_id, code, name, wbs_ids_json, created_by) VALUES (?, ?, 'WP1', 'Concrete works', ?, 'e2e')").run(c, pid, JSON.stringify([w11, w2]));
  const snapshot = { boq: [{ itemNo: '1.1', description: 'M25 concrete', uom: 'cum', qty: '100', costRate: '4842', norms: { lines: [{ type: 'MATERIAL', description: 'Cement', uom: 'bag', rate: '380' }, { type: 'LABOUR', description: 'Mason', uom: 'day', rate: '900' }] } }, { itemNo: '1.2', description: 'Excavation in soil', uom: 'cum', qty: '200', costRate: '150', norms: { lines: [] } }], boqCost: '484200.00', indirects: [{ category: 'Site overhead', description: 'Site office and staff', basis: 'LS', amount: '100000.00' }], commercials: { contingency: '50000.00', risk: '30000.00' } };
  db.prepare("INSERT INTO proj_baseline_packs (company_id, doc_no, doc_date, pack_no, project_id, contract_value, snapshot_json, status, created_by) VALUES (?, ?, '2026-01-02', 1, ?, 1000000000, ?, 'APPROVED', 'e2e')").run(c, `BP/${t}`, pid, JSON.stringify(snapshot));
  const ver = Number(db.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status, created_by) VALUES (?, ?, ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED', 'e2e')").run(c, `BQ/${t}`, pid).lastInsertRowid);
  const item = (code, desc, uom, qty) => Number(db.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount, created_by) VALUES (?, ?, 'ITEM', ?, ?, ?, ?, 0, 0, 'e2e')").run(c, ver, code, desc, uom, qty).lastInsertRowid);
  const i1 = item('1.1', 'M25 concrete', 'cum', 100_000); const i2 = item('1.2', 'Excavation in soil', 'cum', 200_000);
  const split = (line, w, qty) => db.prepare('INSERT INTO proj_boq_line_wbs (company_id, line_id, wbs_id, qty, created_by) VALUES (?, ?, ?, ?, ?)').run(c, line, w, qty, 'e2e');
  split(i1, w11, 60_000); split(i1, w2, 40_000); split(i2, w11, 200_000);
  const norm = (type, desc, uom, q, wst) => db.prepare('INSERT INTO proj_boq_line_norms (company_id, line_id, norm_type, description, uom, qty_per_unit, wastage_pct, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c, i1, type, desc, uom, q, wst, 'e2e');
  norm('MATERIAL', 'Cement', 'bag', 8000, 50_000); norm('LABOUR', 'Mason', 'day', 1500, 0);
  db.close();
  return { u: (k) => `${t}-${k}`, project: pid };
}
async function approve(request, c, roles, user, instanceId, action = 'approve') {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task of instance ${instanceId}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
}
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });

// Part 12.01: a quantity surveyor previews and generates the budget from the signed-off baseline and the BOQ norms, adjusts a line with a reason (the generated value stays beside it), adds a plant line, looks at the views and the margin, phases the budget on an S-curve and sends it;
// the project control manager, the project manager and the project director approve it, it is locked, and a revision starts as version 2. A person without the right sees the no-permission state.
test('AC-01 generate from the baseline, adjust, phase, approve and revise, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = info.project.name === 'mobile' ? 'bgm' : 'bgd';
  const c = await company(request, t.toUpperCase());
  const s = seed(c, t); const qs = s.u('qs'); const se = s.u('se');
  const r = await open(browser, info, c, 'QS', qs, '/bud/generate');
  const errors = watch(r.page);
  await expect(r.page.getByRole('heading', { name: 'Generate Budget from Baseline', level: 1 })).toBeVisible();
  await r.page.getByTestId('gen-project').selectOption(String(s.project));
  await expect(r.page.getByTestId('gen-preview')).toHaveAttribute('data-can', '1');
  await expect(r.page.getByTestId('gen-t-direct')).toContainText('4,84,200.00');
  await expect(r.page.getByTestId('gen-t-difference')).toContainText('0.00');
  await shot(r.page, 'generate-preview', info);
  await noOverflow(r.page);
  await r.page.getByTestId('gen-go').click();
  await expect(r.page.getByTestId('budget')).toBeVisible();
  await expect(r.page.getByTestId('budget')).toHaveAttribute('data-status', 'DRAFT');
  await expect(r.page.getByTestId('bd-t-total')).toContainText('6,64,200.00');
  const id = Number(new URL(r.page.url()).searchParams.get('id'));
  await expect(r.page.getByTestId('bd-line')).toHaveCount(8);
  await shot(r.page, 'workbench-lines', info);
  await noOverflow(r.page);
  // an adjustment keeps the generated value beside it
  await r.page.getByTestId('bd-line-adjust').nth(2).click();
  await r.page.getByTestId('adj-rate').fill('400');
  await r.page.getByTestId('adj-reason').fill('Supplier quote of March');
  await r.page.getByTestId('adj-save').click();
  await expect(r.page.getByTestId('bd-note')).toContainText('adjusted');
  await expect(r.page.locator('[data-testid="bd-line"][data-adjusted="1"]')).toHaveCount(1);
  // a plant line carries quantity and amount (BR-02)
  await r.page.getByTestId('bd-add').click();
  await r.page.getByTestId('add-type').selectOption('EQUIPMENT');
  await r.page.getByTestId('add-name').fill('Excavator hire');
  await r.page.getByTestId('add-uom').fill('hr');
  await r.page.getByTestId('add-reason').fill('Not in the norms');
  await r.page.getByTestId('add-wbs').selectOption({ label: 'W2 Foundations' });
  await r.page.getByTestId('add-code').selectOption({ label: 'PLT-HIRE Hired equipment' });
  await r.page.getByTestId('add-qty').fill('100');
  await r.page.getByTestId('add-amount').fill('50000');
  await shot(r.page, 'workbench-add-line', info);
  await r.page.getByTestId('add-save').click();
  await expect(r.page.getByTestId('bd-line')).toHaveCount(9);
  // the views reconcile
  await r.page.getByRole('tab', { name: 'Views' }).click();
  await expect(r.page.getByTestId('bd-view-row').first()).toBeVisible();
  await r.page.getByTestId('bd-by').selectOption('cost_head');
  await expect(r.page.locator('[data-reconciled="1"]')).toBeVisible();
  await shot(r.page, 'workbench-views', info);
  await noOverflow(r.page);
  // phasing on an S-curve
  await r.page.getByRole('tab', { name: 'Phasing' }).click();
  await r.page.getByTestId('ph-go').click();
  await expect(r.page.getByTestId('ph-status')).toHaveAttribute('data-reconciled', '1');
  await expect(r.page.getByTestId('bd-chart-line')).toBeVisible();
  await shot(r.page, 'workbench-phasing', info);
  await noOverflow(r.page);
  // the margin
  await r.page.getByRole('tab', { name: 'Margin' }).click();
  await expect(r.page.getByTestId('bd-margin')).toHaveAttribute('data-warning', '0');
  await shot(r.page, 'workbench-margin', info);
  await noOverflow(r.page);
  // send and approve
  await r.page.getByRole('tab', { name: 'Lines' }).click();
  await r.page.getByTestId('bd-submit').click();
  await expect(r.page.getByTestId('budget')).toHaveAttribute('data-status', 'SUBMITTED');
  const wf = (await api(request, c, 'QS', qs, 'get', `/bud/budgets/${id}`)).workflowInstanceId;
  await approve(request, c, 'PCMGR', s.u('pcm'), wf); await approve(request, c, 'PM', s.u('pm'), wf); await approve(request, c, 'PD', s.u('pd'), wf);
  await r.page.reload();
  await expect(r.page.getByTestId('budget')).toHaveAttribute('data-status', 'APPROVED');
  await expect(r.page.getByTestId('bd-add')).toHaveCount(0);
  await shot(r.page, 'approved', info);
  // a revision is version 2; the approved original stays
  r.page.once('dialog', (d) => d.accept('Client variation VO-3 adds a basement'));
  await r.page.getByTestId('bd-amend').click();
  await expect(r.page.getByTestId('budget')).toHaveAttribute('data-version', '2');
  await expect(r.page.getByTestId('budget')).toHaveAttribute('data-status', 'DRAFT');
  await r.page.getByRole('tab', { name: 'Versions and history' }).click();
  await expect(r.page.getByTestId('bd-version')).toHaveCount(2);
  await shot(r.page, 'revision', info);
  await noOverflow(r.page);
  // the list
  await r.page.goto('/bud/budgets');
  await expect(r.page.getByRole('heading', { name: 'Budget Versions' }).first()).toBeVisible();
  await shot(r.page, 'list', info);
  expect(errors, errors.join('\n')).toEqual([]);
  // a person without the right
  const n = await open(browser, info, c, 'SE', se, `/bud/budget?id=${id}`);
  await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  await shot(n.page, 'no-permission', info);
});
