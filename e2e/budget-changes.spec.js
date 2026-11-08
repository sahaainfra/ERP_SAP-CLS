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

const OUT = 'docs/erp/screenshots/budget-changes';
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

async function pick(sel, re) {
  let v; await expect.poll(async () => { v = await sel.locator('option').evaluateAll((os, src) => os.find((o) => new RegExp(src).test(o.textContent ?? ''))?.value ?? null, re.source); return v; }).not.toBeNull();
  await sel.selectOption(v);
}
async function approvedBudget(request, c, s) {
  const g = await api(request, c, 'QS', s.u('qs'), 'post', '/bud/generate', { projectId: s.project });
  await api(request, c, 'QS', s.u('qs'), 'post', `/bud/budgets/${g.id}/phasing/generate`, { method: 'SCURVE', profile: 'SCURVE' });
  const sub = await api(request, c, 'QS', s.u('qs'), 'post', `/bud/budgets/${g.id}/submit`, {});
  for (const [r, u] of [['PCMGR', 'pcm'], ['PM', 'pm'], ['PD', 'pd']]) await approve(request, c, r, s.u(u), sub.workflowInstanceId);
  return g.id;
}

// Part 12.02: the project manager asks for a revision of the approved budget with the impact preview (total, share of the budget, margin, band), the project control manager and the project director approve it and it becomes version 2;
// a transfer that does not net to zero and a drawdown above the contingency are refused in the preview; a drawdown against a realised risk goes to the project manager and the project director; the comparison shows what changed between the versions.
test('AC-01 revision, transfer check, contingency drawdown and the version comparison, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = info.project.name === 'mobile' ? 'bcm' : 'bcd';
  const c = await company(request, t.toUpperCase());
  const s = seed(c, t); const pm = s.u('pm'); const pcm = s.u('pcm');
  const v1 = await approvedBudget(request, c, s);
  const r = await open(browser, info, c, 'PM', pm, '/bud/change');
  const errors = watch(r.page);
  await expect(r.page.getByRole('heading', { name: 'New Budget Change Request', level: 1 })).toBeVisible();
  await r.page.getByTestId('bc-project').selectOption(String(s.project));
  await expect(r.page.getByTestId('bc-budget')).toContainText('version 1');
  await r.page.getByTestId('bc-reason').selectOption('RATE_ESCALATION');
  await r.page.getByTestId('bc-title').fill('Cement price rise');
  await r.page.getByTestId('bc-justification').fill('Cement rose 15 % since the estimate (supplier letters attached).');
  await pick(r.page.getByTestId('bc-line-pick').first(), /Direct cost · W2 · Cement/);
  await r.page.getByTestId('bc-line-amount').first().fill('20000');
  await expect(r.page.getByTestId('bc-i-chain')).toHaveText('PCMGR → PD');
  await expect(r.page.getByTestId('bc-i-totalAfter')).toContainText('6,84,200.00');
  await expect(r.page.getByTestId('bc-i-pct')).toContainText('3.0111');
  await shot(r.page, 'revision-preview', info);
  await noOverflow(r.page);
  await r.page.getByTestId('bc-save').click();
  await expect(r.page.getByTestId('bc-change')).toHaveAttribute('data-status', 'DRAFT');
  const id = Number(new URL(r.page.url()).searchParams.get('id'));
  await r.page.getByTestId('bc-submit').click();
  await expect(r.page.getByTestId('bc-change')).toHaveAttribute('data-status', 'SUBMITTED');
  const wf = (await api(request, c, 'PM', pm, 'get', `/bud/changes/${id}`)).workflowInstanceId;
  await approve(request, c, 'PCMGR', pcm, wf); await approve(request, c, 'PD', s.u('pd'), wf);
  await r.page.reload();
  await expect(r.page.getByTestId('bc-change')).toHaveAttribute('data-status', 'APPROVED');
  await expect(r.page.getByTestId('bc-result')).toContainText('v2');
  await shot(r.page, 'revision-approved', info);
  await noOverflow(r.page);
  // a transfer that does not net to zero is refused in the preview (BR-01)
  const p = await open(browser, info, c, 'PCMGR', pcm, '/bud/change');
  await p.page.getByTestId('bc-project').selectOption(String(s.project));
  await p.page.getByTestId('bc-type').selectOption('TRANSFER');
  await p.page.getByTestId('bc-title').fill('Mason to excavation');
  await p.page.getByTestId('bc-justification').fill('Less masonry, more rock excavation found.');
  await pick(p.page.getByTestId('bc-line-pick').first(), /W2 · Mason/);
  await p.page.getByTestId('bc-line-amount').first().fill('-10000');
  await p.page.getByTestId('bc-line-add').click();
  await pick(p.page.getByTestId('bc-line-pick').nth(1), /Excavation in soil/);
  await p.page.getByTestId('bc-line-amount').nth(1).fill('9000');
  await expect(p.page.getByTestId('bc-issues')).toContainText('net to zero');
  await shot(p.page, 'transfer-not-net-zero', info);
  // a drawdown against the realised risk; above the contingency it is refused
  await p.page.goto('/bud/change');
  await p.page.getByTestId('bc-project').selectOption(String(s.project));
  await p.page.getByTestId('bc-type').selectOption('DRAWDOWN');
  await p.page.getByTestId('bc-title').fill('Rock in the foundation');
  await p.page.getByTestId('bc-risk').selectOption(String(s.risk));
  await p.page.getByTestId('bc-justification').fill('The rock found at W2 needs breaking and extra concrete.');
  await pick(p.page.getByTestId('bc-line-pick').first(), /W1.1 · Cement/);
  await p.page.getByTestId('bc-line-amount').first().fill('60000');
  await expect(p.page.getByTestId('bc-issues')).toContainText('more than the contingency left');
  await p.page.getByTestId('bc-line-amount').first().fill('20000');
  await expect(p.page.getByTestId('bc-i-chain')).toHaveText('PM → PD');
  await expect(p.page.getByTestId('bc-i-contingencyAfter')).toContainText('30,000.00');
  await shot(p.page, 'drawdown-preview', info);
  await noOverflow(p.page);
  await p.page.getByTestId('bc-save').click();
  await expect(p.page.getByTestId('bc-change')).toHaveAttribute('data-type', 'DRAWDOWN');
  await p.page.getByTestId('bc-submit').click();
  await expect(p.page.getByTestId('bc-change')).toHaveAttribute('data-status', 'SUBMITTED');
  const did = Number(new URL(p.page.url()).searchParams.get('id'));
  const dwf = (await api(request, c, 'PCMGR', pcm, 'get', `/bud/changes/${did}`)).workflowInstanceId;
  await approve(request, c, 'PM', pm, dwf); await approve(request, c, 'PD', s.u('pd'), dwf);
  await p.page.reload();
  await expect(p.page.getByTestId('bc-change')).toHaveAttribute('data-status', 'APPROVED');
  // the comparison and the history
  await r.page.goto(`/bud/compare?projectId=${s.project}`);
  await expect(r.page.getByRole('heading', { name: 'Budget Version Comparison', level: 1 })).toBeVisible();
  await expect(r.page.getByTestId('cmp-summary')).toContainText('v3');
  await expect(r.page.getByTestId('cmp-row')).toHaveCount(2);
  await expect(r.page.getByTestId('cmp-version')).toHaveCount(3);
  await shot(r.page, 'compare', info);
  await noOverflow(r.page);
  await pick(r.page.getByTestId('cmp-from'), /v1$/);
  await expect(r.page.getByTestId('cmp-total-delta')).toContainText('20,000.00');
  await r.page.goto('/bud/changes');
  await expect(r.page.getByRole('heading', { name: 'Budget Change Requests' }).first()).toBeVisible();
  await shot(r.page, 'list', info);
  expect(errors, errors.join('\n')).toEqual([]);
  void v1;
  const n = await open(browser, info, c, 'SE', s.u('se'), `/bud/change?id=${id}`);
  await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  await shot(n.page, 'no-permission', info);
});
