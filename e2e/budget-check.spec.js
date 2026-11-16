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

const OUT = 'docs/erp/screenshots/budget-check';
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['qs', ['QS']], ['pcm', ['PCMGR']], ['pcm2', ['PCMGR']], ['pm', ['PM']], ['pd', ['PD']], ['dir', ['DIR']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
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
  const risk = Number(db.prepare("INSERT INTO proj_risks (company_id, doc_no, org_project_id, rtype, title, category, owner_user, probability, status, created_by) VALUES (?, ?, ?, 'RISK', 'Rock in the foundation', 'TECHNICAL', ?, 3, 'OCCURRED', 'e2e')").run(c, `RSK/${t}`, pid, `${t}-pm`).lastInsertRowid);
  db.close();
  return { u: (k) => `${t}-${k}`, project: pid, risk };
}
async function approve(request, c, roles, user, instanceId, action = 'approve') {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task of instance ${instanceId}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
}
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });

async function approvedBudget(request, c, s) {
  const g = await api(request, c, 'QS', s.u('qs'), 'post', '/bud/generate', { projectId: s.project });
  await api(request, c, 'QS', s.u('qs'), 'post', `/bud/budgets/${g.id}/phasing/generate`, { method: 'SCURVE', profile: 'SCURVE' });
  const sub = await api(request, c, 'QS', s.u('qs'), 'post', `/bud/budgets/${g.id}/submit`, {});
  for (const [r, u] of [['PCMGR', 'pcm'], ['PM', 'pm'], ['PD', 'pd']]) await approve(request, c, r, s.u(u), sub.workflowInstanceId);
  return g.id;
}

// Part 12.03: the project manager proposes a blocking setting for the purchase-order stage and the project director approves it; a purchase order and a goods receipt reach the ledger as events of the spending modules; the report shows budget, committed and
// actual by WBS node with the documents behind each row and a probe that says an amount over the budget is blocked; the settings page lists the setting with its history. A person without the right sees the no-permission state.
test('AC-01 setting proposed and approved, PO committed, GRN consumed, ledger report, drill-down and availability probe, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = info.project.name === 'mobile' ? 'bkm' : 'bkd';
  const c = await company(request, t.toUpperCase());
  const s = seed(c, t); const pm = s.u('pm'); const pd = s.u('pd'); await approvedBudget(request, c, s);
  const sysUser = `${t}-sys`; const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, sysUser, 'sys', JSON.stringify(['SYSADM']), `${sysUser}@example.com`);
  const st = await api(request, c, 'PM', pm, 'get', `/bud/structure-options?projectId=${s.project}`); const w2 = st.wbs.find((w) => w.code === 'W2').id; const mat = st.costCodes.find((x) => x.code === 'MAT-OTH').id; db.close();
  const r = await open(browser, info, c, 'PM', pm, '/bud/check-settings');
  const errors = watch(r.page);
  await expect(r.page.getByRole('heading', { name: 'Budget Check Settings', level: 1 })).toBeVisible();
  await expect(r.page.getByTestId('cfg-empty')).toBeVisible();
  await r.page.getByTestId('cfg-mode').selectOption('BLOCK');
  await r.page.getByTestId('cfg-stage').selectOption('PO');
  await r.page.getByTestId('cfg-from').fill('2026-01-01');
  await r.page.getByTestId('cfg-reason').fill('Material must not overrun its budget.');
  await shot(r.page, 'settings-propose', info);
  await noOverflow(r.page);
  await r.page.getByTestId('cfg-save').click();
  await expect(r.page.getByTestId('cfg-note')).toBeVisible();
  await expect(r.page.locator('[data-testid="cfg-row"][data-status="PENDING"]')).toHaveCount(1);
  const cfg = (await api(request, c, 'PM', pm, 'get', '/bud/check-config')).rows[0];
  await approve(request, c, 'PD', pd, cfg.workflowInstanceId);
  await r.page.reload();
  await expect(r.page.locator('[data-testid="cfg-row"][data-status="ACTIVE"]')).toHaveCount(1);
  await expect(r.page.getByTestId('cfg-inforce')).toContainText('1 setting');
  await r.page.getByTestId('cfg-history').first().click();
  await expect(r.page.getByTestId('cfg-hist')).toContainText('approve');
  await shot(r.page, 'settings-active', info);
  await noOverflow(r.page);
  // the spending modules: a PO of 1,00,000 and a goods receipt of 40,000 against it
  const line = (amount) => [{ lineId: '1', wbsId: w2, costCodeId: mat, resourceType: 'MATERIAL', qty: 300, amount, description: 'Cement 53 grade' }];
  await api(request, c, 'SYSADM', sysUser, 'post', '/bud/ingest/commitment', { action: 'UPSERT', projectId: s.project, stage: 'PO', sourceType: 'proc_po', sourceId: 'PO-001', docRef: 'PO/2026/001', vendorRef: 'V-77', vendorName: 'Shree Cement Traders', lines: line(100000) });
  await api(request, c, 'SYSADM', sysUser, 'post', '/bud/ingest/actual', { action: 'POST', projectId: s.project, sourceType: 'inv_grn', sourceId: 'GRN-1', docRef: 'GRN-1', vendorRef: 'V-77', vendorName: 'Shree Cement Traders', date: '2026-03-10', lines: [{ lineId: '1', wbsId: w2, costCodeId: mat, resourceType: 'MATERIAL', qty: 100, amount: 40000, commitment: { sourceType: 'proc_po', sourceId: 'PO-001', lineId: '1' } }] });
  await r.page.goto(`/bud/ledger?projectId=${s.project}`);
  await expect(r.page.getByRole('heading', { name: 'Budget vs Committed vs Actual', level: 1 })).toBeVisible();
  const row = r.page.locator('[data-testid="led-row"]', { hasText: 'W2' });
  await expect(row).toContainText('1,81,680.00');
  await expect(row).toContainText('60,000.00');
  await expect(row).toContainText('40,000.00');
  await expect(row).toContainText('81,680.00');
  await row.getByTestId('led-drill').click();
  await expect(r.page.getByTestId('led-commitment')).toContainText('PO/2026/001');
  await expect(r.page.getByTestId('led-actual')).toContainText('GRN-1');
  await shot(r.page, 'ledger', info);
  await noOverflow(r.page);
  await r.page.getByTestId('led-by').selectOption('vendor');
  await expect(r.page.getByTestId('led-row')).toContainText('Shree Cement Traders');
  await r.page.getByTestId('led-by').selectOption('wbs');
  // the availability probe: over the budget it says blocked
  await r.page.getByTestId('probe-wbs').selectOption(String(w2));
  await r.page.getByTestId('probe-code').selectOption(String(mat));
  await expect(r.page.getByTestId('av-available')).toContainText('27,680.00');
  await r.page.getByTestId('probe-amount').fill('20000');
  await expect(r.page.getByTestId('av-asked')).toHaveAttribute('data-result', 'OK');
  await r.page.getByTestId('probe-amount').fill('50000');
  await expect(r.page.getByTestId('av-asked')).toHaveAttribute('data-result', 'BLOCK');
  await shot(r.page, 'availability-block', info);
  await noOverflow(r.page);
  expect(errors, errors.join('\n')).toEqual([]);
  const n = await open(browser, info, c, 'SE', s.u('se'), '/bud/ledger?view=detail');
  await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  await shot(n.page, 'no-permission', info);
});
