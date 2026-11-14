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
// Part 18.03 in the browser (development-header mode, port 3100): cement waits in the inspection stock; a test of 40 bags fails and is rejected, a test of 60 bags passes and is released; the equipment is calibrated, the compliance report and
// the catalogue are opened. Desktop and mobile.
const OUT = 'docs/erp/screenshots/qa-tests';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['sk', ['SK']], ['sm', ['STOREMGR']], ['s2', ['STOREMGR']], ['qe', ['QCE']], ['q2', ['QCE']], ['qm', ['QCMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const A = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${T}-A`, 'Tower A').lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Site 1', 'ACTIVE')").run(c, A, `${T}-S1`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, ?, 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c, `CEM${T}`).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked, batch_tracked) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1, 0)").run(c, `CEM-${T}`, cat).lastInsertRowid);
  const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Cement Ltd', 'Cement', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run(c, `V-${T}`).lastInsertRowid);
  const po = Number(db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, po_site_id, vendor_id, status, requested_by, created_by) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', 'xic1', 'test')").run(c, `PO/${T}`, iso(-1), A, site, vendor).lastInsertRowid);
  const pol = Number(db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, rate, balance_qty, created_by) VALUES (?, ?, 1, ?, 'Line', 100000, 'bag', 4000, 100000, 'test')").run(c, po, item).lastInsertRowid);
  db.close(); return { u: (k) => `${t}-${k}`, T, A, site, po, pol, item };
}
const wfAct = async (request, c, role, user, instanceId, action = 'approve') => { const tasks = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H(role, c, user) })).json()).data.rows; const task = tasks.find((x) => x.instance.id === instanceId); expect(task, `${user} has the task`).toBeTruthy(); await api(request, c, role, user, 'post', `/workflow/tasks/${task.id}/act`, { action }); };
const decide = async (browser, info, c, user, url, act) => { const a = await open(browser, info, c, 'QCE', user, url); await expect(a.page.getByTestId('qa-decide')).toBeVisible(); await a.page.getByTestId(act).click(); await expect(a.page.getByTestId('qa-note')).toBeVisible(); await a.context.close(); };
test('Quality: receiving inspection, a failed and a passed test, calibration, compliance and the catalogue', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `t${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const sm = (m, path, d) => api(request, c, 'STOREMGR', s.u('sm'), m, path, d); const store = await sm('post', '/inv/stores', { code: `${s.T}-ST`, name: 'Site store', type: 'SITE_STORE', projectId: s.A, siteId: s.site, keepers: [s.u('sk')] }); const ss = await sm('post', `/inv/stores/${store.id}/submit`); await wfAct(request, c, 'STOREMGR', s.u('s2'), ss.workflowInstanceId);
  const g = await api(request, c, 'SK', s.u('sk'), 'post', '/inv/grns', { storeId: store.id, poId: s.po, lines: [{ poLineId: s.pol, receivedQty: 100, inspectionRequired: true }] }); const gs = await api(request, c, 'SK', s.u('sk'), 'post', `/inv/grns/${g.id}/submit`); await wfAct(request, c, 'STOREMGR', s.u('sm'), gs.workflowInstanceId);
  await api(request, c, 'QCMGR', s.u('qm'), 'post', '/qa/test-catalogue', { code: 'CEM-STR', name: 'Cement compressive strength', standard: 'IS 269', materialItemId: s.item, parameters: [{ code: 'STR28', name: 'Compressive strength', unit: 'MPa', min: 53, max: null }], freqBasis: 'QTY', freqQty: 50, freqUom: 'bag', labType: 'SITE' });
  await api(request, c, 'QCE', s.u('qe'), 'post', '/qa/lab-equipment', { code: `UTM-${s.T}`, name: 'Compression machine', projectId: s.A, lastCalibrated: iso(-20), intervalDays: 365 });
  const qe = await open(browser, info, c, 'QCE', s.u('qe'), '/qa/receiving'); const p = qe.page; const errors = watch(p);
  await expect(p.getByTestId('qa-receiving')).toBeVisible(); await expect(p.getByTestId('rcv-row')).toHaveCount(1); await noOverflow(p); await shot(p, '1-receiving', info);
  const runTest = async (lot, value, ref, expected, extra) => {
    await p.goto('/qa/receiving'); await p.getByTestId('rcv-row').first().getByRole('link', { name: /.+/ }).last().click(); await expect(p.getByTestId('qa-test-new')).toBeVisible(); await p.getByTestId('trn-test').selectOption({ index: 1 }); await p.getByTestId('trn-lot').fill(String(lot)); await p.getByTestId('trn-sample').fill(ref); await p.getByTestId('trn-create').click();
    await expect(p.getByTestId('qa-test-object')).toBeVisible(); const url = p.url().replace(/^https?:\/\/[^/]+/, ''); await p.getByTestId('tr-visual').check(); await p.getByTestId('tr-docs').check(); await p.getByTestId('tr-value-STR28').fill(String(value)); await p.getByTestId('tr-equipment-STR28').selectOption({ index: 1 }); await p.getByTestId('tr-save').click();
    await expect(p.getByTestId('qa-test-object')).toHaveAttribute('data-result', expected); await noOverflow(p); if (extra) await extra(); await p.getByTestId('qa-submit').click(); await expect(p.getByTestId('qa-test-object')).toHaveAttribute('data-status', 'SUBMITTED'); return url;
  };
  const u1 = await runTest(40, 45, 'S-1', 'FAIL', async () => { await shot(p, '2-failed', info); }); await decide(browser, info, c, s.u('q2'), u1, 'qa-approve'); await p.goto(u1); await expect(p.getByTestId('qa-test-object')).toHaveAttribute('data-outcome', 'REJECTED');
  const u2 = await runTest(60, 55.5, 'S-2', 'PASS'); await decide(browser, info, c, s.u('q2'), u2, 'qa-approve'); await p.goto(u2); await expect(p.getByTestId('qa-test-object')).toHaveAttribute('data-outcome', 'ACCEPTED'); await shot(p, '3-passed', info);
  await p.goto('/qa/test-compliance'); await expect(p.getByTestId('tc-row')).toHaveCount(1); await expect(p.getByTestId('tc-row')).toHaveAttribute('data-status', 'OK'); await noOverflow(p); await shot(p, '4-compliance', info);
  await p.goto('/qa/lab-equipment'); await expect(p.getByTestId('qa-equipment')).toBeVisible(); await p.getByRole('link', { name: new RegExp(`UTM-${s.T}`) }).first().click(); await expect(p.getByTestId('qa-equipment-object')).toHaveAttribute('data-calibration', 'OK'); await p.getByTestId('le-go').click(); await expect(p.getByTestId('le-note')).toBeVisible(); await noOverflow(p); await shot(p, '5-equipment', info);
  const qm = await open(browser, info, c, 'QCMGR', s.u('qm'), '/qa/test-catalogue'); await expect(qm.page.getByTestId('qa-catalogue')).toBeVisible(); await qm.page.goto('/qa/test-catalogue?new=1'); await expect(qm.page.getByTestId('qa-catalogue-editor')).toBeVisible(); await noOverflow(qm.page); await shot(qm.page, '6-catalogue', info);
  await p.goto('/qa/test-requests'); await expect(p.getByTestId('qa-tests')).toBeVisible(); expect(errors, errors.join('\n')).toEqual([]);
});
