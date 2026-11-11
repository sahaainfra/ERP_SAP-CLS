import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|ERR_INTERNET_DISCONNECTED|Cannot reach the server|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const api = async (request, c, roles, user, method, path, data) => { const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data }); expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') }); const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' }); return id;
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use; const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true }); const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) }); await page.goto(path); return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
// Part 14.07 in the browser (development-header mode, port 3100): project controls open the cost control dashboard of a project whose budget, commitment and actual cost come from the ledgers, drill from a figure to its source
// documents, reconcile, read the variance analysis and export it; the quantity surveyor proposes where an unallocated cost belongs and the project manager approves it (maker-checker); a site engineer has no access.
const OUT = 'docs/erp/screenshots/site-control';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const today = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);

async function seed(request, c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['pcm', ['PCMGR']], ['pm', ['PM']], ['se', ['SE']], ['qs', ['QS']], ['pd', ['PD']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower C', 'BUILDING', 'ACTIVE')").run(c, `${T}-C`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (?, ?, ?, 100000000, '2026-01-01', '2026-12-31', 'e2e')").run(c, pid, `${t}-pm`);
  const wbs = (code, name) => Number(db.prepare('INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, ?, ?, 1, ?)').run(c, pid, code, name, 'e2e').lastInsertRowid);
  const w1 = wbs('1', 'Substructure'); const w2 = wbs('2', 'Superstructure'); const [c1, c2] = db.prepare('SELECT id FROM fin_cost_codes ORDER BY id LIMIT 2').all().map((x) => x.id);
  const bud = Number(db.prepare("INSERT INTO bud_budgets (company_id, doc_no, doc_date, org_project_id, name, status, created_by, source_type) VALUES (?, ?, ?, ?, 'Budget', 'APPROVED', 'e2e', 'test')").run(c, `BUD/${T}/1`, today(), pid).lastInsertRowid);
  for (const [w, cc, rt, qty, amt] of [[w1, c1, 'MATERIAL', 600000, 60_000_000], [w2, c2, 'LABOUR', 400000, 40_000_000]]) db.prepare("INSERT INTO bud_lines (company_id, budget_id, line_kind, wbs_id, cost_code_id, resource_type, resource_name, qty, amount, created_by, source_type) VALUES (?, ?, 'DIRECT', ?, ?, ?, 'Work', ?, ?, 'e2e', 'test')").run(c, bud, w, cc, rt, qty, amt);
  db.close();
  const ledger = (kind, path, body) => api(request, c, 'SYSADM', 'e2e-setup', 'post', `/bud/ingest/${kind}`, body);
  const line = (id, extra) => ({ lineId: id, qty: 100, ...extra });
  await ledger('commitment', '', { action: 'UPSERT', projectId: pid, stage: 'PO', sourceType: 'proc_po', sourceId: `PO-${T}`, docRef: `PO/${T}/1`, vendorRef: 'V-1', vendorName: 'Shree Traders', lines: [line('1', { wbsId: w1, costCodeId: c1, resourceType: 'MATERIAL', amount: 200000 })] });
  const post = (id, sourceType, lines) => ledger('actual', '', { action: 'POST', projectId: pid, sourceType, sourceId: id, docRef: id, vendorRef: 'V-1', vendorName: 'Shree Traders', date: today(), lines });
  await post(`GD-${T}`, 'GRN_DIRECT', [line('1', { wbsId: w1, costCodeId: c1, resourceType: 'MATERIAL', amount: 130000 })]);
  await post(`GS-${T}`, 'GRN_STOCK', [line('1', { wbsId: w1, costCodeId: c1, resourceType: 'MATERIAL', amount: 50000 })]);
  await post(`BILL-${T}`, 'SUBCONTRACT_BILL', [line('1', { resourceType: 'SUBCONTRACT', qty: 1, amount: 70000 })]);
  await api(request, c, 'PCMGR', `${t}-pcm`, 'post', '/site/control/refresh', { projectId: pid });
  return { u: (k) => `${t}-${k}`, pid, T };
}

test('project cost control: the dashboard drills to the source documents, the variance is analysed and exported, an unallocated cost is allocated by QS and approved by the PM', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `c${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(request, c, t);
  const pcm = await open(browser, info, c, 'PCMGR', s.u('pcm'), `/site/control?projectId=${s.pid}`); const p = pcm.page; const errors = watch(p);
  await expect(p.getByTestId('site-control')).toBeVisible(); await expect(p.getByTestId('ctl-budget')).toContainText('10,00,000'); await expect(p.getByTestId('ctl-committed')).toContainText('2,00,000'); await expect(p.getByTestId('ctl-actual')).toContainText('2,00,000');
  await expect(p.getByTestId('ctl-unalloc')).toContainText('1'); await expect(p.getByTestId('ctl-exceptions')).toContainText('unallocated cost line'); await expect(p.getByTestId('ctl-row')).toHaveCount(3);
  // every figure opens the documents behind it: the actual of the substructure is the direct receipt, and the receipt into the store is shown as not counted
  await p.getByTestId('ctl-row').filter({ hasText: 'Substructure' }).getByTestId('ctl-cell-actual').click(); await expect(p.getByTestId('ctl-drill')).toBeVisible(); await expect(p.getByTestId('ctl-drill-row')).toHaveCount(2); await expect(p.getByTestId('ctl-drill')).toContainText(`GD-${s.T}`); await expect(p.getByTestId('ctl-drill')).toContainText('Not counted'); await expect(p.getByTestId('ctl-drill-total')).toContainText('1,30,000');
  await shot(p, 'dashboard-drill', info); await p.getByTestId('ctl-drill-close').click(); await expect(p.getByTestId('ctl-drill')).toHaveCount(0);
  await p.getByTestId('ctl-by').selectOption('byResource'); await expect(p.getByTestId('ctl-row')).toHaveCount(3); await p.getByTestId('ctl-by').selectOption('byCostHead'); await expect(p.getByTestId('ctl-row').first()).toBeVisible(); await p.getByTestId('ctl-by').selectOption('byWbs');
  await p.getByTestId('ctl-reconcile').click(); await expect(p.getByTestId('ctl-recon-note')).toContainText('Clean'); await noOverflow(p); await shot(p, 'dashboard', info);
  // the variance analysis: the quantity and rate variance add up to the cost variance; it exports
  await p.goto(`/site/control-variance?projectId=${s.pid}`); await expect(p.getByTestId('cvr-table')).toBeVisible(); await expect(p.getByTestId('cvr-row')).toHaveCount(3); await expect(p.getByTestId('cvr-totals')).toBeVisible();
  const down = p.waitForEvent('download'); await p.getByTestId('cvr-export-csv').click(); expect((await down).suggestedFilename()).toContain('.csv');
  await p.getByTestId('cvr-by').selectOption('RESOURCE'); await expect(p.getByTestId('cvr-row')).toHaveCount(3); await noOverflow(p); await shot(p, 'variance', info); expect(errors).toEqual([]);
  // the quantity surveyor proposes the allocation of the unallocated bill; the sender cannot decide it
  const qs = await open(browser, info, c, 'QS', s.u('qs'), '/site/control-unallocated'); const q = qs.page; const qe = watch(q);
  await expect(q.getByTestId('site-control-unallocated')).toBeVisible(); await expect(q.locator('[data-testid^="row-"], [data-testid="list-card"]').locator('visible=true').first()).toBeVisible(); await shot(q, 'unallocated-list', info);
  await q.locator('[data-testid^="row-"], [data-testid="list-card"]').locator('visible=true').first().getByRole('link').first().click(); await expect(q.getByTestId('alloc-object')).toBeVisible(); await expect(q.getByTestId('alloc-amount')).toContainText('70,000');
  await expect(q.getByTestId('alloc-approve')).toHaveCount(0); await q.getByTestId('alloc-submit').click(); await expect(q.getByTestId('alloc-error')).toBeVisible();
  await q.getByTestId('alloc-wbs').selectOption({ label: '2 Superstructure' }); await q.getByTestId('alloc-code').selectOption({ index: 1 }); await q.getByTestId('alloc-submit').click(); await expect(q.getByTestId('alloc-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(q.getByTestId('alloc-form')).toHaveCount(0); await expect(q.getByTestId('alloc-approve')).toHaveCount(0); await noOverflow(q); await shot(q, 'unallocated-submitted', info); expect(qe).toEqual([]);
  // the project manager decides it; the figures now carry it
  const url = q.url(); const pm = await open(browser, info, c, 'PM', s.u('pm'), url.replace(/^https?:\/\/[^/]+/, '')); const m = pm.page; const me = watch(m);
  await expect(m.getByTestId('alloc-decide')).toBeVisible(); await m.getByTestId('alloc-approve').click(); await expect(m.getByTestId('alloc-object')).toHaveAttribute('data-status', 'ALLOCATED'); await expect(m.getByTestId('alloc-to')).toContainText('Superstructure'); await shot(m, 'unallocated-approved', info); expect(me).toEqual([]);
  await p.goto(`/site/control?projectId=${s.pid}`); await expect(p.getByTestId('ctl-unalloc')).toContainText('0'); await expect(p.getByTestId('ctl-row').filter({ hasText: 'Superstructure' }).getByTestId('ctl-cell-actual')).toContainText('70,000');
  // a site engineer has no access
  const se = await open(browser, info, c, 'SE', s.u('se'), '/site/control'); await expect(se.page.getByText('site.control.view')).toBeVisible(); expect(errors).toEqual([]);
});
